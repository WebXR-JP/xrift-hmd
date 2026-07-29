# DENDEN VR

DENDEN VR は、Seeed Studio XIAO ESP32C3 と Bosch BNO055 搭載の
AE-BNO055-BO を使って、ヘッドマウントディスプレイ向けの姿勢データを取得する
プロトタイプです。

Arduino ファームウェアが BNO055 から UART で姿勢を読み取り、USB Serial と
Bluetooth LE の両方へ配信します。ブラウザ側のビューアでは、その姿勢データを
受信して 3D の基板モデルに反映できます。

## 構成

| パス | 内容 |
| --- | --- |
| `arduino/xiao_bno055_orientation/` | XIAO ESP32C3 に書き込む Arduino ファームウェア |
| `WebBLE_TestTool/` | USB Serial / Web Bluetooth で姿勢を確認するブラウザビューア |
| `packages/denden-protocol/` | BLEバイナリの共通codecとDENDEN VRプロトコルv2仕様 |

## ハードウェア

- Seeed Studio XIAO ESP32C3
- AE-BNO055-BO
- タクトスイッチ
- [KY-023互換 2軸ジョイスティックモジュール](https://www.amazon.co.jp/dp/B0B5GSQVXQ) x 2
- [TC74HC4053AP 3回路2:1アナログMUX](https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=5Z24-2DHX)
- 0.1 uFセラミックコンデンサ
- USB ケーブル
- ジャンパーワイヤ

### 配線

| XIAO ESP32C3 | AE-BNO055-BO |
| --- | --- |
| 3V3 | VIN |
| GND | GND |
| D7 / GPIO20 / RX | SDA/T, sensor TX |
| D6 / GPIO21 / TX | SCL/R, sensor RX |
| D10 / GPIO10 | タクトスイッチの片側 |
| GND | タクトスイッチのもう片側 |

TX と RX は交差接続します。AE-BNO055-BO は電源投入前に UART モードへ設定して
ください。BNO055 の UART は `115200 bps / 8N1` 固定です。

タクトスイッチは `D10 / GPIO10` と `GND` の間に接続します。ファームウェアが
`INPUT_PULLUP` を使用するため、外付けプルアップ抵抗は不要です。押下時は `LOW`、
開放時は `HIGH` になります。

### ジョイスティック配線

XIAO ESP32C3の `D0 / GPIO2` は起動モードに影響するstrapping pinのため、
ジョイスティックには使用しません。`D1` と `D2` で4軸を読むため、
TC74HC4053APのX/Y回路を2:1 MUXとして使います。

ジョイスティックモジュール:

| Joystick 1 | Joystick 2 | 接続先 |
| --- | --- | --- |
| `+5V` | `+5V` | XIAO `3V3` |
| `GND` | `GND` | XIAO `GND` |
| `VRx` | - | TC74HC4053AP pin 12 (`0X`) |
| - | `VRx` | TC74HC4053AP pin 13 (`1X`) |
| `VRy` | - | TC74HC4053AP pin 2 (`0Y`) |
| - | `VRy` | TC74HC4053AP pin 1 (`1Y`) |
| `SW` | - | XIAO `D4 / GPIO6` |
| - | `SW` | XIAO `D5 / GPIO7` |

モジュール上の電源端子が `+5V` 表記でも、XIAOのADCへ5 Vを入力しないよう、
必ず `3V3` へ接続します。すべてのGNDは共通にします。

TC74HC4053AP（DIP16、上面視）:

| Pin | 信号 | 接続先 |
| --- | --- | --- |
| 14 | `X-COM` | XIAO `D1 / GPIO3 / ADC1_CH3` |
| 15 | `Y-COM` | XIAO `D2 / GPIO4 / ADC1_CH4` |
| 11 | `A` | XIAO `D3 / GPIO5` |
| 10 | `B` | XIAO `D3 / GPIO5` |
| 9 | `C` | GND |
| 6 | `INH` | GND |
| 7 | `VEE` | GND |
| 8 | `GND` | GND |
| 16 | `VCC` | XIAO `3V3` |
| 3, 4, 5 | Z回路 | 未接続 |

pin 16 (`VCC`) とpin 8 (`GND`) の直近に0.1 uFのセラミックコンデンサを接続します。
`A` と `B` を同じ `D3` で駆動し、LOWでJoystick 1、HIGHでJoystick 2のX/Yを
同時に選択します。

起動時に32サンプルを使って各軸の中央を自動校正します。電源投入またはリセット時は
2本とも手を離してください。中央付近には約3%のdead zoneを適用します。

### 入力の増設

ファームウェア先頭の設定配列で入力構成を定義します。

- ジョイスティックは`kJoysticks`へMUXチャネルと押し込みピンを追加する
- タクトスイッチは`kTactButtonPins`へピンを追加する
- 軸数、ボタン数、BLEの分割数、USB JSON、TestToolの表示数は自動で追従する

現在のTC74HC4053AP配線は2チャネル切替のため、ジョイスティックは2本までです。
3本以上へ増設する場合は、X軸用とY軸用にアドレス線を共有できる多チャネルMUXへ
交換し、`kJoystickMuxSelectPins`へアドレスピンを追加します。タクトスイッチは
利用可能なGPIOの範囲なら配列への追加だけで増設できます。GPIOが不足する場合は
I/Oエキスパンダーが必要です。

## ファームウェア

1. Arduino IDE の Boards Manager で ESP32 ボードを追加します。
2. ボードとして `XIAO_ESP32C3` を選択します。
3. `arduino/xiao_bno055_orientation/xiao_bno055_orientation.ino` を開いて書き込みます。

ESP32 Core 付属の BLE ライブラリを使うため、追加の Arduino ライブラリは不要です。

起動後、ファームウェアは以下を行います。

- BNO055 を UART 経由で初期化し、NDOF モードで姿勢を取得する
- USB Serial に JSON Lines 形式で姿勢データを出力する
- Bluetooth LE の Notify で姿勢を 20 バイトのバイナリ形式で配信する
- Capabilitiesで接続中の軸数、ボタン数、ジョイスティック数を公開する
- ジョイスティックとタクトスイッチを汎用Input Reportで配信する
- 温度、キャリブレーション状態、UART エラー数を付加する

USB Serial の出力例:

```json
{"type":"ready","sensor":"BNO055","protocol_version":2,"axis_count":4,"button_count":3,"joystick_count":2}
{"type":"imu","t":12345,"qw":0.998901,"qx":0.012345,"qy":-0.003210,"qz":0.045678,"heading":12.34,"roll":1.23,"pitch":-0.45,"temp_c":27,"cal":{"sys":3,"gyro":3,"accel":3,"mag":2},"uart_errors":0}
{"type":"input","t":12360,"joystick_count":2,"axes":[0.1250,-0.5000,0.0000,1.0000],"buttons":[false,true,false]}
```

## Bluetooth LE

BLE デバイス名は `DENDEN-VR` です。

アプリケーション側でペイロードを直接読む必要はありません。
[`denden-protocol`](packages/denden-protocol/README.md) が、姿勢と汎用入力の
encode/decode、入力state更新、TypeScript型、BLE UUIDを提供します。ワイヤ仕様は
[`DENDEN VRプロトコル v2`](packages/denden-protocol/SPEC.md) に分離しています。

| 種別 | UUID |
| --- | --- |
| Service | `f3641400-00b0-4240-ba50-05ca45bf8abc` |
| Orientation Notify Characteristic | `f3641401-00b0-4240-ba50-05ca45bf8abc` |
| Capabilities Read Characteristic | `f3641402-00b0-4240-ba50-05ca45bf8abc` |
| Input Report Notify Characteristic | `f3641403-00b0-4240-ba50-05ca45bf8abc` |

姿勢Notify payload は little-endian の 20 バイトです。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32_t` | `millis()` |
| `4..11` | `int16_t x 4` | Quaternion `w, x, y, z`。`1.0 = 16384` |
| `12..17` | `int16_t x 3` | Heading, Roll, Pitch。`1 degree = 16` |
| `18` | `int8_t` | 温度 |
| `19` | `uint8_t` | Calibration。`SYS/GYR/ACC/MAG` を各 2 bit で格納 |

Capabilitiesはlittle-endianの8バイトです。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0` | `uint8_t` | プロトコルバージョン。現在は`2` |
| `1` | `uint8_t` | Input Reportバージョン。現在は`1` |
| `2` | `uint8_t` | 軸数 |
| `3` | `uint8_t` | ボタン数 |
| `4` | `uint8_t` | ジョイスティック数 |
| `5..7` | `uint8_t[3]` | 予約領域 |

Input Reportは8バイトの共通ヘッダーと可変長データで構成します。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32_t` | `millis()` |
| `4` | `uint8_t` | Reportバージョン |
| `5` | `uint8_t` | `1`: axes、`2`: buttons |
| `6` | `uint8_t` | 先頭の入力番号 |
| `7` | `uint8_t` | 値の数 |
| `8..` | 可変 | axesは`int16_t`配列、buttonsはbit packed |

1回の通知は既定ATT MTUに収まる最大20バイトです。軸が6個、ボタンが96個を
超える場合はoffsetを進めて複数のReportへ自動分割します。

## ブラウザビューア

`WebBLE_TestTool/index.html` は、ファームウェアから届く姿勢データを確認するための
開発用ビューアです。USB Serial と Web Bluetooth の両方に対応しています。

ローカルで起動する場合:

```powershell
python -m http.server 8000
```

リポジトリのルートで起動し、ChromeまたはEdgeで
`http://localhost:8000/WebBLE_TestTool/` を開きます。

- USB で使う場合は `USB接続` を押し、XIAO ESP32C3 のシリアルポートを選びます。
- BLE で使う場合は `BLE接続` を押し、`DENDEN-VR` を選びます。
- `ゼロ合わせ` は現在の姿勢を表示上の基準姿勢にします。
- `軸変換` は実機の取り付け方向と画面上の回転方向が合わない場合に変更します。
- タクトスイッチとジョイスティックの表示数はCapabilitiesから自動生成されます。
- ジョイスティック欄には位置、正規化したX/Y値、押し込み状態が表示されます。

Web Bluetooth は HTTPS または `localhost` のセキュアコンテキストが必要です。
iPhone / iPad の Safari は Web Bluetooth API に対応していません。

## トラブルシューティング

- BNO055 が応答しない場合は、TX/RX の交差接続、電源、UART モードのジャンパー設定を確認してください。
- モードジャンパーを変更した後は、USB を抜き差ししてセンサーを電源投入からやり直してください。
- BLE デバイス一覧に出るのに接続できない場合は、XIAO を PC またはスマートフォンへ近づけ、Bluetooth アダプタが BLE に対応しているか確認してください。
- 表示だけを確認したい場合は `http://localhost:8000/?renderer=canvas` を開くと、Three.js を使わず内蔵 canvas レンダラーで表示します。
