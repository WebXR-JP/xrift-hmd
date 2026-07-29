# denden-protocol

`denden-protocol` は、DENDEN VRのワイヤプロトコルを扱う、フレームワーク非依存の
JavaScript codecです。実行時依存関係はなく、`ArrayBuffer`、`DataView`、
TypedArray、ブラウザESM、Node.js、各種バンドラーで利用できます。

## 使い方

```js
import {
  BLE,
  decodeOrientationPayload,
  decodeButtonPayload,
} from "denden-protocol";

const service = await gatt.getPrimaryService(BLE.serviceUuid);
const orientationCharacteristic = await service.getCharacteristic(
  BLE.orientationCharacteristicUuid
);

orientationCharacteristic.addEventListener(
  "characteristicvaluechanged",
  (event) => {
    const orientation = decodeOrientationPayload(event.target.value);
    console.log(orientation.qw, orientation.heading);
  }
);
```

復号した姿勢オブジェクトは、DENDEN VRのUSB JSONパケットと同じ形式です。
アプリケーションはBLEとUSBで状態管理や描画処理を共通化できます。

```js
{
  type: "imu",
  t: 12345,
  qw: 1,
  qx: 0,
  qy: 0,
  qz: 0,
  heading: 12.5,
  roll: 1.25,
  pitch: -0.5,
  temp_c: 27,
  cal: { sys: 3, gyro: 3, accel: 3, mag: 2 }
}
```

## React

このパッケージはReactに依存しません。コンポーネントまたはカスタムhookから
Web Bluetooth Characteristicを購読し、復号した値をそのままstateへ格納できます。

```jsx
function useDendenOrientation(characteristic) {
  const [orientation, setOrientation] = React.useState(null);

  React.useEffect(() => {
    if (!characteristic) return;

    const onValue = (event) => {
      setOrientation(decodeOrientationPayload(event.target.value));
    };

    characteristic.addEventListener("characteristicvaluechanged", onValue);
    return () => {
      characteristic.removeEventListener("characteristicvaluechanged", onValue);
    };
  }, [characteristic]);

  return orientation;
}
```

プロトコルの詳細と互換性要件は、[SPEC.md](./SPEC.md)を参照してください。
