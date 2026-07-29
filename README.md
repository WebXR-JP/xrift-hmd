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
| `packages/denden-protocol/` | BLE バイナリの共通codecとDENDEN VRプロトコル v1仕様 |

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

## ファームウェア

1. Arduino IDE の Boards Manager で ESP32 ボードを追加します。
2. ボードとして `XIAO_ESP32C3` を選択します。
3. `arduino/xiao_bno055_orientation/xiao_bno055_orientation.ino` を開いて書き込みます。

ESP32 Core 付属の BLE ライブラリを使うため、追加の Arduino ライブラリは不要です。

起動後、ファームウェアは以下を行います。

- BNO055 を UART 経由で初期化し、NDOF モードで姿勢を取得する
- USB Serial に JSON Lines 形式で姿勢データを出力する
- Bluetooth LE の Notify で姿勢を 20 バイトのバイナリ形式で配信する
- タクトスイッチをデバウンスし、状態変化を専用 BLE Characteristic で通知する
- 2本のジョイスティックをMUX経由で読み、BLE 50 Hz / USB JSON 25 Hzで配信する
- 温度、キャリブレーション状態、UART エラー数を付加する

USB Serial の出力例:

```json
{"type":"imu","t":12345,"qw":0.998901,"qx":0.012345,"qy":-0.003210,"qz":0.045678,"heading":12.34,"roll":1.23,"pitch":-0.45,"temp_c":27,"cal":{"sys":3,"gyro":3,"accel":3,"mag":2},"button":{"pressed":false,"press_count":0},"uart_errors":0}
{"type":"joystick","t":12360,"joysticks":[{"x":0.1250,"y":-0.5000,"pressed":false},{"x":0.0000,"y":1.0000,"pressed":true}]}
```

## Bluetooth LE

BLE デバイス名は `DENDEN-VR` です。

アプリケーション側でペイロードを直接読む必要はありません。
[`denden-protocol`](packages/denden-protocol/README.md) が、姿勢とボタンの
encode/decode、TypeScript型、BLE UUIDを提供します。ワイヤ仕様は
[`DENDEN VRプロトコル v1`](packages/denden-protocol/SPEC.md) に分離しています。

| 種別 | UUID |
| --- | --- |
| Service | `f3641400-00b0-4240-ba50-05ca45bf8abc` |
| Orientation Notify Characteristic | `f3641401-00b0-4240-ba50-05ca45bf8abc` |
| Button Read / Notify Characteristic | `f3641402-00b0-4240-ba50-05ca45bf8abc` |
| Joystick Read / Notify Characteristic | `f3641403-00b0-4240-ba50-05ca45bf8abc` |

姿勢Notify payload は little-endian の 20 バイトです。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32_t` | `millis()` |
| `4..11` | `int16_t x 4` | Quaternion `w, x, y, z`。`1.0 = 16384` |
| `12..17` | `int16_t x 3` | Heading, Roll, Pitch。`1 degree = 16` |
| `18` | `int8_t` | 温度 |
| `19` | `uint8_t` | Calibration。`SYS/GYR/ACC/MAG` を各 2 bit で格納 |

ボタンNotify payload は little-endian の 8 バイトです。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32_t` | `millis()` |
| `4` | `uint8_t` | Flags。bit 0 が `1` のとき押下中 |
| `5` | `uint8_t` | 予約領域 |
| `6..7` | `uint16_t` | 起動後の押下回数 |

ボタン特性は状態変化時にNotifyされます。接続直後はWebページが一度READするため、
接続前から押していた場合も現在状態を取得できます。押下回数はXIAOの再起動で
`0` に戻ります。

ジョイスティックNotify payloadはlittle-endianの14バイトです。軸値はADCの中央を
`0`、両端をおおむね `-1.0` と `1.0` に正規化します。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32_t` | `millis()` |
| `4..5` | `int16_t` | Joystick 1 X。`1.0 = 32767` |
| `6..7` | `int16_t` | Joystick 1 Y。`1.0 = 32767` |
| `8..9` | `int16_t` | Joystick 2 X。`1.0 = 32767` |
| `10..11` | `int16_t` | Joystick 2 Y。`1.0 = 32767` |
| `12` | `uint8_t` | Flags。bit 0/1がJoystick 1/2の押下状態 |
| `13` | `uint8_t` | 予約領域 |

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
- タクトスイッチ欄には現在の押下状態と起動後の押下回数が表示されます。
- ジョイスティック欄には2本の位置、正規化したX/Y値、押し込み状態が表示されます。

Web Bluetooth は HTTPS または `localhost` のセキュアコンテキストが必要です。
iPhone / iPad の Safari は Web Bluetooth API に対応していません。

## トラブルシューティング

- BNO055 が応答しない場合は、TX/RX の交差接続、電源、UART モードのジャンパー設定を確認してください。
- モードジャンパーを変更した後は、USB を抜き差ししてセンサーを電源投入からやり直してください。
- BLE デバイス一覧に出るのに接続できない場合は、XIAO を PC またはスマートフォンへ近づけ、Bluetooth アダプタが BLE に対応しているか確認してください。
- 表示だけを確認したい場合は `http://localhost:8000/?renderer=canvas` を開くと、Three.js を使わず内蔵 canvas レンダラーで表示します。
