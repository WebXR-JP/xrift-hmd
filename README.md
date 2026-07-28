# XIAO ESP32C3 + AE-BNO055-BO 姿勢ビューア

XIAO ESP32C3 が BNO055 から UART でクォータニオンを読み、USB Serial と Bluetooth LEへ同時配信します。`WebBLE_TestTool/index.html` は Web Serial APIまたはWeb Bluetooth APIで姿勢を受け取り、3D基板モデルへ反映します。

## 配線

| XIAO ESP32C3 | AE-BNO055-BO |
| --- | --- |
| 3V3 | VIN |
| GND | GND |
| D7 / GPIO20 / RX | SDA/T（センサー TX） |
| D6 / GPIO21 / TX | SCL/R（センサー RX） |

TX と RX は交差接続します。AE-BNO055-BO は電源投入前に UART モード（BNO055 の `PS0=Low`、`PS1=High`）へ設定してください。ジャンパ変更後はUSBを抜き差ししてセンサーを電源再投入します。

BNO055 UARTは `115200 bps / 8N1` 固定です。Euler角とクォータニオンを1つの応答で一括取得し、応答ヘッダまたはデータ長が不正なフレームは破棄して再試行します。

## Arduino

1. Arduino IDE の Boards Manager で ESP32 を入れ、ボードに `XIAO_ESP32C3` を選びます。
2. `arduino/xiao_bno055_orientation/xiao_bno055_orientation.ino` を開いて書き込みます。ESP32 Core付属のBLEライブラリを使うため、追加ライブラリは不要です。
3. USB接続を使う場合はシリアルモニタを閉じます。ブラウザ側が同じUSB Serialポートを使います。

出力例:

```json
{"type":"imu","t":12345,"qw":0.998901,"qx":0.012345,"qy":-0.003210,"qz":0.045678,"heading":12.34,"roll":1.23,"pitch":-0.45,"temp_c":27,"cal":{"sys":3,"gyro":3,"accel":3,"mag":2}}
```

## WebBLE Test Tool

`WebBLE_TestTool/index.html` を localhost で開きます。

```powershell
cd WebBLE_TestTool
python -m http.server 8000
```

その後、ChromeまたはEdgeで `http://localhost:8000/` を開きます。

- USBを使う場合は `USB接続` を押し、XIAO ESP32C3のシリアルポートを選びます。
- BLEを使う場合は `BLE接続` を押し、`XRift-BNO055` を選びます。USBケーブルは給電だけでも構いません。

BLEのサービスUUIDは `f3641400-00b0-4240-ba50-05ca45bf8abc`、姿勢Notify特性は `f3641401-00b0-4240-ba50-05ca45bf8abc` です。1通知は20バイトで、クォータニオン・Euler角・温度・キャリブレーションを50Hzで送ります。

AndroidスマートフォンではChromeでHTTPS配信したページを開いてください。PCのIPアドレスを使った `http://192.168.x.x:8000/` はセキュアコンテキストではないため、Web Bluetoothを使用できません。iPhone/iPadのSafariはWeb Bluetooth APIに対応していません。

### BLE接続のトラブルシュート

デバイス一覧に `XRift-BNO055` が出るのに `Connection attempt failed` となる場合、広告の受信には成功していますが、その後の双方向GATT接続に失敗しています。

1. XIAOをPCまたはスマートフォンのすぐ近くへ移動します。金属ケースやUSBハブの裏へ置かないでください。
2. デスクトップPCのWi-Fi/Bluetooth外部アンテナが接続されていることを確認します。
3. 古い `Generic Bluetooth Radio` やCSR系USBドングルでは、BLE広告だけ見えてGATT接続できない場合があります。Bluetooth 5.x対応のUSBアダプタ、またはPC内蔵のIntel/Realtek Bluetoothを使用します。
4. XIAOの電源を入れ直してからページを再読み込みします。Webページは一時的なGATT失敗を最大3回まで自動再試行します。

ネットワークなしで表示確認したい場合は `http://localhost:8000/?renderer=canvas` を開くと内蔵 canvas 描画だけを使います。
3D表示の補間遅延は現在 `0 ms` で、受信済みの最新姿勢を最短で描画します。通信間隔のばらつきが見える場合は、`WebBLE_TestTool/index.html` の `interpolationDelayMs` を `20` から `65` 程度へ増やすと滑らかさを優先できます。
クォータニオンのノルムが異常な場合は、一時的に Euler 角から姿勢を復元し、画面に `Euler補完中` と表示します。
クォータニオンへ戻すのは25フレーム連続で正常になった後なので、入力源がフレームごとに往復することはありません。

## 操作

- `ゼロ合わせ`: 現在の姿勢を表示上の原点にします。
- `軸変換`: 実物を動かした向きと画面上の回転方向が合わない場合に切り替えます。
- キャリブレーション値は `0` から `3` で、`3` に近いほど安定します。
