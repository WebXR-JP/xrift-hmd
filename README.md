# XRift HMD

XRift HMD は、Seeed Studio XIAO ESP32C3 と Bosch BNO055 搭載の
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

## ハードウェア

- Seeed Studio XIAO ESP32C3
- AE-BNO055-BO
- USB ケーブル
- ジャンパーワイヤ

### 配線

| XIAO ESP32C3 | AE-BNO055-BO |
| --- | --- |
| 3V3 | VIN |
| GND | GND |
| D7 / GPIO20 / RX | SDA/T, sensor TX |
| D6 / GPIO21 / TX | SCL/R, sensor RX |

TX と RX は交差接続します。AE-BNO055-BO は電源投入前に UART モードへ設定して
ください。BNO055 の UART は `115200 bps / 8N1` 固定です。

## ファームウェア

1. Arduino IDE の Boards Manager で ESP32 ボードを追加します。
2. ボードとして `XIAO_ESP32C3` を選択します。
3. `arduino/xiao_bno055_orientation/xiao_bno055_orientation.ino` を開いて書き込みます。

ESP32 Core 付属の BLE ライブラリを使うため、追加の Arduino ライブラリは不要です。

起動後、ファームウェアは以下を行います。

- BNO055 を UART 経由で初期化し、NDOF モードで姿勢を取得する
- USB Serial に JSON Lines 形式で姿勢データを出力する
- Bluetooth LE の Notify で同じ姿勢データを 20 バイトのバイナリ形式で配信する
- 温度、キャリブレーション状態、UART エラー数を付加する

USB Serial の出力例:

```json
{"type":"imu","t":12345,"qw":0.998901,"qx":0.012345,"qy":-0.003210,"qz":0.045678,"heading":12.34,"roll":1.23,"pitch":-0.45,"temp_c":27,"cal":{"sys":3,"gyro":3,"accel":3,"mag":2},"uart_errors":0}
```

## Bluetooth LE

BLE デバイス名は `XRift-BNO055` です。

| 種別 | UUID |
| --- | --- |
| Service | `f3641400-00b0-4240-ba50-05ca45bf8abc` |
| Orientation Notify Characteristic | `f3641401-00b0-4240-ba50-05ca45bf8abc` |

Notify payload は little-endian の 20 バイトです。

| Offset | 型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32_t` | `millis()` |
| `4..11` | `int16_t x 4` | Quaternion `w, x, y, z`。`1.0 = 16384` |
| `12..17` | `int16_t x 3` | Heading, Roll, Pitch。`1 degree = 16` |
| `18` | `int8_t` | 温度 |
| `19` | `uint8_t` | Calibration。`SYS/GYR/ACC/MAG` を各 2 bit で格納 |

## ブラウザビューア

`WebBLE_TestTool/index.html` は、ファームウェアから届く姿勢データを確認するための
開発用ビューアです。USB Serial と Web Bluetooth の両方に対応しています。

ローカルで起動する場合:

```powershell
cd WebBLE_TestTool
python -m http.server 8000
```

その後、Chrome または Edge で `http://localhost:8000/` を開きます。

- USB で使う場合は `USB接続` を押し、XIAO ESP32C3 のシリアルポートを選びます。
- BLE で使う場合は `BLE接続` を押し、`XRift-BNO055` を選びます。
- `ゼロ合わせ` は現在の姿勢を表示上の基準姿勢にします。
- `軸変換` は実機の取り付け方向と画面上の回転方向が合わない場合に変更します。

Web Bluetooth は HTTPS または `localhost` のセキュアコンテキストが必要です。
iPhone / iPad の Safari は Web Bluetooth API に対応していません。

## トラブルシューティング

- BNO055 が応答しない場合は、TX/RX の交差接続、電源、UART モードのジャンパー設定を確認してください。
- モードジャンパーを変更した後は、USB を抜き差ししてセンサーを電源投入からやり直してください。
- BLE デバイス一覧に出るのに接続できない場合は、XIAO を PC またはスマートフォンへ近づけ、Bluetooth アダプタが BLE に対応しているか確認してください。
- 表示だけを確認したい場合は `http://localhost:8000/?renderer=canvas` を開くと、Three.js を使わず内蔵 canvas レンダラーで表示します。

