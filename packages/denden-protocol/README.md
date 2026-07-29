# denden-protocol

`denden-protocol`はDENDEN VRのワイヤプロトコルを扱う、フレームワーク非依存の
JavaScript codecです。実行時依存関係はなく、`ArrayBuffer`、`DataView`、
TypedArray、ブラウザESM、Node.js、各種バンドラーで利用できます。

## BLE入力

接続後にCapabilitiesをREADし、その入力数でstateを作ります。Input Reportは
軸数に応じて複数に分割されるため、`applyInputReport`で順番に反映します。

```js
import {
  BLE,
  applyInputReport,
  createInputState,
  decodeCapabilitiesPayload,
  decodeInputReportPayload,
  toJoystickStates,
} from "denden-protocol";

const service = await gatt.getPrimaryService(BLE.serviceUuid);
const capabilitiesCharacteristic = await service.getCharacteristic(
  BLE.capabilitiesCharacteristicUuid
);
const inputCharacteristic = await service.getCharacteristic(
  BLE.inputCharacteristicUuid
);

const capabilities = decodeCapabilitiesPayload(
  await capabilitiesCharacteristic.readValue()
);
let input = createInputState(capabilities);

inputCharacteristic.addEventListener(
  "characteristicvaluechanged",
  (event) => {
    const report = decodeInputReportPayload(event.target.value);
    input = applyInputReport(input, report);

    console.log(input.axes, input.buttons);
    console.log(toJoystickStates(input));
  }
);
await inputCharacteristic.startNotifications();
```

`axes`と`buttons`はCapabilitiesで宣言された長さを持ちます。ジョイスティックは
各2軸と押し込みボタンへ変換できます。

```js
[
  { x: 0.25, y: -0.5, pressed: false },
  { x: 0, y: 1, pressed: true },
]
```

## React

`applyInputReport`は元のstateを変更せず、新しいオブジェクトを返します。
Reactのstate更新関数へそのまま渡せます。

```jsx
function useDendenInput(characteristic, capabilities) {
  const [input, setInput] = React.useState(() =>
    createInputState(capabilities)
  );

  React.useEffect(() => {
    const onValue = (event) => {
      const report = decodeInputReportPayload(event.target.value);
      setInput((current) => applyInputReport(current, report));
    };

    characteristic.addEventListener("characteristicvaluechanged", onValue);
    return () => {
      characteristic.removeEventListener(
        "characteristicvaluechanged",
        onValue
      );
    };
  }, [characteristic]);

  return input;
}
```

Capabilitiesが変わった場合は`createInputState`を再実行してください。

## 姿勢

姿勢Characteristicは従来どおり単独で復号できます。

```js
import { BLE, decodeOrientationPayload } from "denden-protocol";

const characteristic = await service.getCharacteristic(
  BLE.orientationCharacteristicUuid
);
characteristic.addEventListener("characteristicvaluechanged", (event) => {
  const orientation = decodeOrientationPayload(event.target.value);
  console.log(orientation.qw, orientation.heading);
});
```

プロトコルの詳細は[SPEC.md](./SPEC.md)を参照してください。
