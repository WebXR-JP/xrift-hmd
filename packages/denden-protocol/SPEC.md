# DENDEN VRプロトコル v2

複数バイト値はすべてlittle-endianです。UUIDは大文字と小文字を区別せずに
比較します。v2では入力数をCapabilitiesで公開し、軸とボタンを可変長の
Input Reportとして送信します。

## Bluetooth LE

| 項目 | 値 |
| --- | --- |
| Service | `f3641400-00b0-4240-ba50-05ca45bf8abc` |
| 姿勢Characteristic | `f3641401-00b0-4240-ba50-05ca45bf8abc` |
| Capabilities Characteristic | `f3641402-00b0-4240-ba50-05ca45bf8abc` |
| Input Report Characteristic | `f3641403-00b0-4240-ba50-05ca45bf8abc` |

リファレンスファームウェアは`DENDEN-VR`という名前でadvertiseします。
CapabilitiesはREAD、Input ReportはNotifyに対応します。

## 入力番号

軸とボタンにはそれぞれ0始まりの番号を付けます。

- Joystick `i`のX軸はaxis `2 * i`
- Joystick `i`のY軸はaxis `2 * i + 1`
- Joystick `i`の押し込みはbutton `i`
- 独立したタクトスイッチはJoystickの押し込みに続くbutton

この規則により、受信側は`joystickCount`だけで軸と押し込みを組み立てられます。

## Capabilities

Capabilitiesは8バイト固定です。予約領域は送信時に`0`とし、受信時は無視します。

| Offset | ワイヤ型 | 内容 |
| --- | --- | --- |
| `0` | `uint8` | プロトコルバージョン。v2は`2` |
| `1` | `uint8` | Input Reportバージョン。現在は`1` |
| `2` | `uint8` | 軸数 |
| `3` | `uint8` | ボタン数 |
| `4` | `uint8` | ジョイスティック数 |
| `5..7` | `uint8[3]` | 予約領域 |

`axisCount`は`joystickCount * 2`以上、`buttonCount`は`joystickCount`以上で
なければなりません。

## Input Report

Input Reportは8バイトの共通ヘッダーと可変長データから成ります。

| Offset | ワイヤ型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32` | デバイス起動後の経過時間（ミリ秒） |
| `4` | `uint8` | Input Reportバージョン。現在は`1` |
| `5` | `uint8` | 種別。`1`: axes、`2`: buttons |
| `6` | `uint8` | 先頭の軸番号またはボタン番号 |
| `7` | `uint8` | このReportに含む値の数 |
| `8..` | 可変 | 種別ごとのデータ |

### Axes Report

軸値は`-1.0`から`1.0`を符号付き16bit整数へ正規化し、
`1.0 = 32767`とします。データ部は値の順に`int16`で格納します。

既定ATT MTUの実データ上限20バイトに収めるため、1 Reportは最大6軸です。
7軸以上を送信する場合はoffsetを進め、同じtimestampを持つ複数のReportへ
分割します。

### Buttons Report

ボタン状態はデータ部へbit packedで格納します。button `offset + i`が
押下中ならデータ部のbit `i`を`1`にします。未使用の上位bitは`0`です。

1 Reportは最大96ボタンです。97個以上を送信する場合はoffsetを進めて
複数のReportへ分割します。

受信側はCapabilitiesで宣言された長さの配列を用意し、Reportのoffsetから
値を上書きします。範囲外のReportは拒否しなければなりません。

## 姿勢パケット

姿勢Characteristicは20バイトのREAD / Notifyを送信します。

| Offset | ワイヤ型 | 内容 |
| --- | --- | --- |
| `0..3` | `uint32` | デバイス起動後の経過時間（ミリ秒） |
| `4..5` | `int16` | Quaternion W、スケール`1 / 16384` |
| `6..7` | `int16` | Quaternion X、スケール`1 / 16384` |
| `8..9` | `int16` | Quaternion Y、スケール`1 / 16384` |
| `10..11` | `int16` | Quaternion Z、スケール`1 / 16384` |
| `12..13` | `int16` | Heading（度）、スケール`1 / 16` |
| `14..15` | `int16` | Roll（度）、スケール`1 / 16` |
| `16..17` | `int16` | Pitch（度）、スケール`1 / 16` |
| `18` | `int8` | 温度（摂氏） |
| `19` | `uint8` | キャリブレーションレベル |

キャリブレーションは上位bitから`SYS`、`GYR`、`ACC`、`MAG`の順に、
各レベルを符号なし2bit値で格納します。

## バージョニング

Input Reportのレイアウトを互換性なく変更する場合は、Reportバージョンを変更します。
既存の意味を変える場合や新しい通信モデルへ移行する場合は、プロトコルバージョンと
Characteristic UUIDを変更します。未知のバージョンを受信した実装は復号を
中止しなければなりません。
