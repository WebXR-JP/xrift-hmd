/*
  XIAO ESP32C3 + AE-BNO055-BO UART orientation streamer

  BNO055からUARTで姿勢を読み、タクトスイッチの状態と合わせて次の2経路へ配信する。
    1. USB Serial: デバッグしやすいJSON Lines
    2. Bluetooth LE: 姿勢20バイトとスイッチ8バイトの固定長Notify

  AE-BNO055-BOは電源投入前にUARTモードへ設定すること。

  配線:
    XIAO 3V3  -> AE-BNO055-BO VIN
    XIAO GND  -> AE-BNO055-BO GND
    XIAO D7   <- AE-BNO055-BO SDA/T (sensor TX)
    XIAO D6   -> AE-BNO055-BO SCL/R (sensor RX)
    XIAO D2   -> tact switch -> GND

  タクトスイッチ入力はINPUT_PULLUPなので外付けプルアップ抵抗は不要。
  押すとLOW、離すとHIGHになる。

  姿勢Notifyペイロード（little-endian、合計20バイト）:
     0.. 3: uint32_t millis()
     4..11: int16_t quaternion W/X/Y/Z（1.0 = 16384）
    12..17: int16_t heading/roll/pitch（1度 = 16）
        18: int8_t temperature
        19: uint8_t calibration（SYS/GYR/ACC/MAGを各2bit）

  スイッチNotifyペイロード（little-endian、合計8バイト）:
     0.. 3: uint32_t millis()
         4: uint8_t flags（bit 0: pressed）
         5: uint8_t reserved
     6.. 7: uint16_t press count（起動後の押下回数）
*/

#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>

constexpr uint32_t kUsbSerialBaud = 115200;
constexpr uint32_t kSensorUartBaud = 115200;
constexpr int8_t kSensorRxPin = 20;  // XIAO ESP32C3 D7
constexpr int8_t kSensorTxPin = 21;  // XIAO ESP32C3 D6
constexpr int8_t kButtonPin = 4;      // XIAO ESP32C3 D2
constexpr uint16_t kSampleIntervalMs = 20;  // 50 Hz
constexpr uint16_t kStatusIntervalMs = 500;
constexpr uint16_t kUartTimeoutMs = 30;
constexpr uint16_t kButtonDebounceMs = 20;

// BNO055 UARTプロトコルのフレーム種別。データシート上の固定値。
constexpr uint8_t kUartStartByte = 0xAA;
constexpr uint8_t kUartWrite = 0x00;
constexpr uint8_t kUartRead = 0x01;
constexpr uint8_t kUartReadResponse = 0xBB;
constexpr uint8_t kUartStatusResponse = 0xEE;
constexpr uint8_t kUartWriteSuccess = 0x01;

// 使用するBNO055 Page 0レジスタ。
constexpr uint8_t kChipIdRegister = 0x00;
constexpr uint8_t kPageIdRegister = 0x07;
constexpr uint8_t kEulerHeadingLsbRegister = 0x1A;
constexpr uint8_t kTemperatureRegister = 0x34;
constexpr uint8_t kCalibrationStatusRegister = 0x35;
constexpr uint8_t kOperationModeRegister = 0x3D;
constexpr uint8_t kPowerModeRegister = 0x3E;
constexpr uint8_t kSystemTriggerRegister = 0x3F;

constexpr uint8_t kBno055ChipId = 0xA0;
constexpr uint8_t kOperationModeConfig = 0x00;
constexpr uint8_t kOperationModeNdof = 0x0C;
constexpr uint8_t kPowerModeNormal = 0x00;
constexpr uint8_t kUseExternalCrystal = 0x80;

// 0x1Aから14バイト読むとEuler角6バイトとQuaternion8バイトを一括取得できる。
constexpr uint8_t kOrientationPayloadLength = 14;
constexpr uint8_t kBlePayloadLength = 20;
constexpr uint8_t kBleButtonPayloadLength = 8;
constexpr double kQuaternionScale = 1.0 / 16384.0;
constexpr double kEulerScale = 1.0 / 16.0;

constexpr char kBleDeviceName[] = "DENDEN-VR";
constexpr char kBleServiceUuid[] =
    "f3641400-00b0-4240-ba50-05ca45bf8abc";
constexpr char kBleOrientationUuid[] =
    "f3641401-00b0-4240-ba50-05ca45bf8abc";
constexpr char kBleButtonUuid[] =
    "f3641402-00b0-4240-ba50-05ca45bf8abc";

// 温度・キャリブレーションは姿勢より更新頻度が低いためキャッシュする。
uint8_t cachedCalibration = 0;
int8_t cachedTemperature = 0;
uint32_t uartErrorCount = 0;
bool sensorReady = false;

// 機械接点のチャタリングを除去するため、生入力と確定状態を別々に保持する。
bool buttonRawPressed = false;
bool buttonPressed = false;
uint32_t buttonRawChangedAt = 0;
uint16_t buttonPressCount = 0;

// BLEコールバックはBluetoothタスクから呼ばれるため、loop()と共有する値はvolatileにする。
volatile bool bleConnected = false;
volatile bool bleRestartAdvertising = false;
volatile bool bleConnectionEventPending = false;
volatile bool bleConnectionEventState = false;
BLEServer *bleServer = nullptr;
BLECharacteristic *bleOrientationCharacteristic = nullptr;
BLECharacteristic *bleButtonCharacteristic = nullptr;

class OrientationServerCallbacks : public BLEServerCallbacks {
 public:
  void onConnect(BLEServer *server) override {
    bleConnected = true;
    bleConnectionEventState = true;
    bleConnectionEventPending = true;
  }

  void onDisconnect(BLEServer *server) override {
    bleConnected = false;
    bleConnectionEventState = false;
    bleConnectionEventPending = true;
    bleRestartAdvertising = true;
  }
};

// 前回の失敗応答や途中まで届いたフレームを捨て、次の要求の境界を揃える。
void clearSensorInput() {
  while (Serial1.available()) {
    Serial1.read();
  }
}

bool readSensorByte(uint8_t &value, uint16_t timeoutMs = kUartTimeoutMs) {
  const uint32_t startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    if (Serial1.available()) {
      value = static_cast<uint8_t>(Serial1.read());
      return true;
    }
    delay(1);
  }
  return false;
}

bool readSensorBytes(uint8_t *buffer, uint8_t length) {
  for (uint8_t i = 0; i < length; ++i) {
    if (!readSensorByte(buffer[i])) {
      return false;
    }
  }
  return true;
}

bool readRegisters(uint8_t registerAddress, uint8_t *buffer, uint8_t length) {
  // BNO055は処理中に一時的なエラー応答を返すことがある。
  // 1フレームを丸ごと再試行し、壊れた複数バイト値を上位へ渡さない。
  for (uint8_t attempt = 0; attempt < 3; ++attempt) {
    clearSensorInput();

    const uint8_t command[] = {
        kUartStartByte, kUartRead, registerAddress, length};
    Serial1.write(command, sizeof(command));
    Serial1.flush();

    uint8_t header = 0;
    uint8_t responseLength = 0;
    if (!readSensorByte(header) || !readSensorByte(responseLength)) {
      uartErrorCount++;
      delay(2);
      continue;
    }

    if (header == kUartReadResponse && responseLength == length &&
        readSensorBytes(buffer, length)) {
      return true;
    }

    if (header == kUartReadResponse) {
      // 想定外の長さでも応答本体を読み捨て、次回の0xAA要求と混線させない。
      for (uint8_t i = 0; i < responseLength; ++i) {
        uint8_t ignored = 0;
        if (!readSensorByte(ignored)) {
          break;
        }
      }
    }

    uartErrorCount++;
    delay(2);
  }

  return false;
}

bool writeRegisters(
    uint8_t registerAddress, const uint8_t *data, uint8_t length) {
  // 書き込みも読み出しと同様にフレーム単位で再試行する。
  for (uint8_t attempt = 0; attempt < 3; ++attempt) {
    clearSensorInput();

    const uint8_t header[] = {
        kUartStartByte, kUartWrite, registerAddress, length};
    Serial1.write(header, sizeof(header));
    Serial1.write(data, length);
    Serial1.flush();

    uint8_t responseHeader = 0;
    uint8_t status = 0;
    if (readSensorByte(responseHeader) && readSensorByte(status) &&
        responseHeader == kUartStatusResponse &&
        status == kUartWriteSuccess) {
      return true;
    }

    uartErrorCount++;
    delay(2);
  }

  return false;
}

bool writeRegister(uint8_t registerAddress, uint8_t value) {
  return writeRegisters(registerAddress, &value, 1);
}

bool waitForChipId(uint16_t timeoutMs) {
  // 電源投入直後はBNO055の起動完了まで応答しないため、CHIP_IDをポーリングする。
  const uint32_t startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    uint8_t chipId = 0;
    if (readRegisters(kChipIdRegister, &chipId, 1) &&
        chipId == kBno055ChipId) {
      return true;
    }
    delay(100);
  }
  return false;
}

bool initializeSensor() {
  if (!waitForChipId(2500)) {
    return false;
  }

  // 動作モードやクロック源はCONFIGMODEでのみ安全に変更できる。
  if (!writeRegister(kOperationModeRegister, kOperationModeConfig)) {
    return false;
  }
  delay(30);

  if (!writeRegister(kPageIdRegister, 0x00) ||
      !writeRegister(kPowerModeRegister, kPowerModeNormal)) {
    return false;
  }
  delay(10);

  if (!writeRegister(kSystemTriggerRegister, kUseExternalCrystal)) {
    return false;
  }
  delay(10);

  // NDOFで加速度・ジャイロ・地磁気を統合した絶対姿勢を出力する。
  if (!writeRegister(kOperationModeRegister, kOperationModeNdof)) {
    return false;
  }
  delay(30);

  return true;
}

int16_t readInt16Le(const uint8_t *buffer) {
  return static_cast<int16_t>(
      static_cast<uint16_t>(buffer[0]) |
      (static_cast<uint16_t>(buffer[1]) << 8));
}

void writeUint32Le(uint8_t *buffer, uint32_t value) {
  buffer[0] = value & 0xFF;
  buffer[1] = (value >> 8) & 0xFF;
  buffer[2] = (value >> 16) & 0xFF;
  buffer[3] = (value >> 24) & 0xFF;
}

void writeUint16Le(uint8_t *buffer, uint16_t value) {
  buffer[0] = value & 0xFF;
  buffer[1] = (value >> 8) & 0xFF;
}

void writeInt16Le(uint8_t *buffer, int16_t value) {
  const uint16_t raw = static_cast<uint16_t>(value);
  buffer[0] = raw & 0xFF;
  buffer[1] = (raw >> 8) & 0xFF;
}

bool hasValidQuaternionNorm(
    int16_t quaternionW,
    int16_t quaternionX,
    int16_t quaternionY,
    int16_t quaternionZ) {
  // BNO055のQuaternionは1.0を16384で表すため、4成分の二乗和は
  // 16384^2付近になる。UART再同期直後などの単発破損を配信前に除外する。
  constexpr int64_t kExpectedNormSquared = 16384LL * 16384LL;
  constexpr int64_t kMinimumNormSquared =
      kExpectedNormSquared * 98LL * 98LL / 10000LL;
  constexpr int64_t kMaximumNormSquared =
      kExpectedNormSquared * 102LL * 102LL / 10000LL;

  const int64_t normSquared =
      static_cast<int64_t>(quaternionW) * quaternionW +
      static_cast<int64_t>(quaternionX) * quaternionX +
      static_cast<int64_t>(quaternionY) * quaternionY +
      static_cast<int64_t>(quaternionZ) * quaternionZ;
  return normSquared >= kMinimumNormSquared &&
      normSquared <= kMaximumNormSquared;
}

void initializeBle() {
  // Web Bluetoothから選択しやすい固定名と128bit UUIDでGATTサーバを構築する。
  BLEDevice::init(kBleDeviceName);
  // 小型アンテナとUSBドングルの組み合わせでも届きやすいよう広告出力を最大化する。
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_ADV);
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_DEFAULT);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new OrientationServerCallbacks());

  BLEService *service = bleServer->createService(kBleServiceUuid);
  bleOrientationCharacteristic = service->createCharacteristic(
      kBleOrientationUuid,
      BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_NOTIFY);
  // 0x2902(CCCD)はブラウザがNotify購読を有効化するために必要。
  bleOrientationCharacteristic->addDescriptor(new BLE2902());

  // スイッチは姿勢とは更新周期が異なるため別Characteristicにする。
  // これにより、既定ATT MTUで収まる20バイト姿勢形式との互換性も維持できる。
  bleButtonCharacteristic = service->createCharacteristic(
      kBleButtonUuid,
      BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_NOTIFY);
  bleButtonCharacteristic->addDescriptor(new BLE2902());

  // 接続直後にREADされても必ず20バイト返るよう、初期値も固定長にする。
  uint8_t initialValue[kBlePayloadLength] = {};
  bleOrientationCharacteristic->setValue(
      initialValue, sizeof(initialValue));

  // Web側はNotify購読後にREADして、接続前から押されていた状態も取得する。
  uint8_t initialButtonValue[kBleButtonPayloadLength] = {};
  writeUint32Le(&initialButtonValue[0], millis());
  initialButtonValue[4] = buttonPressed ? 0x01 : 0x00;
  writeUint16Le(&initialButtonValue[6], buttonPressCount);
  bleButtonCharacteristic->setValue(
      initialButtonValue, sizeof(initialButtonValue));
  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(kBleServiceUuid);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void notifyBleOrientation(
    uint32_t timestamp,
    int16_t quaternionW,
    int16_t quaternionX,
    int16_t quaternionY,
    int16_t quaternionZ,
    int16_t heading,
    int16_t roll,
    int16_t pitch) {
  if (!bleConnected || bleOrientationCharacteristic == nullptr) {
    return;
  }

  // ATTの既定MTU 23では実データを20バイトまで送れる。
  // 分割を避けるため、浮動小数点ではなくBNO055の生int16値をそのまま詰める。
  uint8_t payload[kBlePayloadLength] = {};
  writeUint32Le(&payload[0], timestamp);
  writeInt16Le(&payload[4], quaternionW);
  writeInt16Le(&payload[6], quaternionX);
  writeInt16Le(&payload[8], quaternionY);
  writeInt16Le(&payload[10], quaternionZ);
  writeInt16Le(&payload[12], heading);
  writeInt16Le(&payload[14], roll);
  writeInt16Le(&payload[16], pitch);
  payload[18] = static_cast<uint8_t>(cachedTemperature);
  payload[19] = cachedCalibration;

  bleOrientationCharacteristic->setValue(payload, sizeof(payload));
  bleOrientationCharacteristic->notify();
}

void publishButtonState(uint32_t timestamp, bool sendNotification) {
  if (bleButtonCharacteristic == nullptr) {
    return;
  }

  uint8_t payload[kBleButtonPayloadLength] = {};
  writeUint32Le(&payload[0], timestamp);
  payload[4] = buttonPressed ? 0x01 : 0x00;
  // payload[5]は将来のフラグ追加に備えて0のまま予約する。
  writeUint16Le(&payload[6], buttonPressCount);

  // 未接続中もCharacteristicのREAD値を最新状態へ更新しておく。
  bleButtonCharacteristic->setValue(payload, sizeof(payload));
  if (sendNotification && bleConnected) {
    bleButtonCharacteristic->notify();
  }
}

void printButtonEvent(uint32_t timestamp) {
  Serial.print("{\"type\":\"button\",\"t\":");
  Serial.print(timestamp);
  Serial.print(",\"pressed\":");
  Serial.print(buttonPressed ? "true" : "false");
  Serial.print(",\"press_count\":");
  Serial.print(buttonPressCount);
  Serial.println("}");
}

void updateButton(uint32_t now) {
  // INPUT_PULLUPなのでLOWが押下。生入力が変わるたびに安定待ち時間をやり直す。
  const bool rawPressed = digitalRead(kButtonPin) == LOW;
  if (rawPressed != buttonRawPressed) {
    buttonRawPressed = rawPressed;
    buttonRawChangedAt = now;
  }

  // 同じ値が一定時間続いた場合だけ確定し、接点バウンスによる多重押下を防ぐ。
  if (
      rawPressed != buttonPressed &&
      now - buttonRawChangedAt >= kButtonDebounceMs) {
    buttonPressed = rawPressed;
    if (buttonPressed) {
      buttonPressCount++;
    }
    publishButtonState(now, true);
    printButtonEvent(now);
  }
}

void printJsonString(const char *value) {
  // ステータスメッセージをJSON文字列として壊さないため、最低限のエスケープを行う。
  Serial.print('"');
  for (const char *p = value; *p != '\0'; ++p) {
    if (*p == '"' || *p == '\\') {
      Serial.print('\\');
    }
    Serial.print(*p);
  }
  Serial.print('"');
}

void printStatus(const char *type, const char *message) {
  Serial.print("{\"type\":");
  printJsonString(type);
  Serial.print(",\"message\":");
  printJsonString(message);
  Serial.println("}");
}

void updateCachedStatus() {
  // 温度(0x34)とCALIB_STAT(0x35)は隣接しているため1トランザクションで読む。
  uint8_t status[2] = {};
  if (readRegisters(kTemperatureRegister, status, sizeof(status))) {
    cachedTemperature = static_cast<int8_t>(status[0]);
    cachedCalibration = status[1];
  }
}

void printReady() {
  Serial.print(
      "{\"type\":\"ready\",\"sensor\":\"BNO055\","
      "\"transport\":\"uart\",\"format\":\"quaternion\","
      "\"read_mode\":\"uart\",\"rate_hz\":50,"
      "\"ble_name\":\"");
  Serial.print(kBleDeviceName);
  Serial.println("\",\"button_pin\":\"D2\"}");
}

void printBleConnectionEvent() {
  Serial.print("{\"type\":\"ble\",\"state\":\"");
  Serial.print(bleConnectionEventState ? "connected" : "disconnected");
  Serial.println("\"}");
}

void setup() {
  Serial.begin(kUsbSerialBaud);

  const uint32_t waitStartedAt = millis();
  while (!Serial && millis() - waitStartedAt < 2000) {
    delay(10);
  }

  // D2とGNDの間にスイッチを接続する。起動時の状態をBLE初期値へ反映する。
  pinMode(kButtonPin, INPUT_PULLUP);
  buttonRawPressed = digitalRead(kButtonPin) == LOW;
  buttonPressed = buttonRawPressed;
  buttonRawChangedAt = millis();

  // BNO055 UARTは115200/8N1固定。TX/RXは交差接続する。
  Serial1.begin(
      kSensorUartBaud, SERIAL_8N1, kSensorRxPin, kSensorTxPin);

  // センサー初期化が失敗してもBLE広告とエラー表示は使えるよう、BLEを先に開始する。
  initializeBle();
  delay(1000);

  sensorReady = initializeSensor();
  if (sensorReady) {
    updateCachedStatus();
    printReady();
  } else {
    printStatus(
        "error",
        "BNO055 did not respond over UART. Check crossed TX/RX wiring and "
        "power-cycle after changing the mode jumpers.");
  }
}

void loop() {
  static uint32_t lastSampleAt = 0;
  static uint32_t lastStatusAt = 0;
  static uint32_t lastReconnectAttemptAt = 0;
  const uint32_t now = millis();

  // コールバック内でSerialやBLE再初期化を行うとタスク間競合しやすい。
  // フラグだけ受け取り、実処理はArduinoのloop()側で行う。
  if (bleConnectionEventPending) {
    bleConnectionEventPending = false;
    printBleConnectionEvent();
  }

  if (bleRestartAdvertising) {
    bleRestartAdvertising = false;
    bleServer->startAdvertising();
  }

  // センサー未接続時や50Hz待機中でも、スイッチは毎loopで監視して遅延を抑える。
  updateButton(now);

  if (!sensorReady) {
    // 配線修正やセンサー再起動後に、XIAOをリセットせず自動復帰できるようにする。
    if (now - lastReconnectAttemptAt >= 2000) {
      lastReconnectAttemptAt = now;
      sensorReady = initializeSensor();
      if (sensorReady) {
        printReady();
      }
    }
    return;
  }

  // delay()で周期を作らず、BLEタスクへ実行時間を渡しながら50Hzを維持する。
  if (now - lastSampleAt < kSampleIntervalMs) {
    return;
  }
  lastSampleAt = now;

  // Euler角とQuaternionを別々に読むと時刻がずれるため、連続14バイトで取得する。
  uint8_t orientation[kOrientationPayloadLength] = {};
  if (!readRegisters(
          kEulerHeadingLsbRegister,
          orientation,
          kOrientationPayloadLength)) {
    return;
  }

  if (now - lastStatusAt >= kStatusIntervalMs) {
    lastStatusAt = now;
    updateCachedStatus();
  }

  const int16_t rawHeading = readInt16Le(&orientation[0]);
  const int16_t rawRoll = readInt16Le(&orientation[2]);
  const int16_t rawPitch = readInt16Le(&orientation[4]);
  const int16_t rawQuaternionW = readInt16Le(&orientation[6]);
  const int16_t rawQuaternionX = readInt16Le(&orientation[8]);
  const int16_t rawQuaternionY = readInt16Le(&orientation[10]);
  const int16_t rawQuaternionZ = readInt16Le(&orientation[12]);

  // 異常値を1フレームだけ描画するより、次の20ms周期まで保持した方が滑らか。
  // ここで捨てた回数もuart_errorsへ含め、配線や通信品質の診断材料にする。
  if (!hasValidQuaternionNorm(
          rawQuaternionW,
          rawQuaternionX,
          rawQuaternionY,
          rawQuaternionZ)) {
    uartErrorCount++;
    return;
  }

  // CALIB_STATは [SYS:2][GYR:2][ACC:2][MAG:2] のビット配置。
  const uint8_t calSystem = (cachedCalibration >> 6) & 0x03;
  const uint8_t calGyro = (cachedCalibration >> 4) & 0x03;
  const uint8_t calAccel = (cachedCalibration >> 2) & 0x03;
  const uint8_t calMag = cachedCalibration & 0x03;

  // 同一サンプルをBLEバイナリとUSB JSONの両方へ配信する。
  notifyBleOrientation(
      now,
      rawQuaternionW,
      rawQuaternionX,
      rawQuaternionY,
      rawQuaternionZ,
      rawHeading,
      rawRoll,
      rawPitch);

  Serial.print("{\"type\":\"imu\",\"t\":");
  Serial.print(now);
  Serial.print(",\"qw\":");
  Serial.print(rawQuaternionW * kQuaternionScale, 6);
  Serial.print(",\"qx\":");
  Serial.print(rawQuaternionX * kQuaternionScale, 6);
  Serial.print(",\"qy\":");
  Serial.print(rawQuaternionY * kQuaternionScale, 6);
  Serial.print(",\"qz\":");
  Serial.print(rawQuaternionZ * kQuaternionScale, 6);
  Serial.print(",\"heading\":");
  Serial.print(rawHeading * kEulerScale, 2);
  Serial.print(",\"roll\":");
  Serial.print(rawRoll * kEulerScale, 2);
  Serial.print(",\"pitch\":");
  Serial.print(rawPitch * kEulerScale, 2);
  Serial.print(",\"temp_c\":");
  Serial.print(cachedTemperature);
  Serial.print(",\"cal\":{\"sys\":");
  Serial.print(calSystem);
  Serial.print(",\"gyro\":");
  Serial.print(calGyro);
  Serial.print(",\"accel\":");
  Serial.print(calAccel);
  Serial.print(",\"mag\":");
  Serial.print(calMag);
  Serial.print("},\"button\":{\"pressed\":");
  Serial.print(buttonPressed ? "true" : "false");
  Serial.print(",\"press_count\":");
  Serial.print(buttonPressCount);
  Serial.print("},\"uart_errors\":");
  Serial.print(uartErrorCount);
  Serial.println("}");
}
