import assert from "node:assert/strict";
import test from "node:test";

import {
  BLE,
  DendenProtocolError,
  applyInputReport,
  createInputState,
  decodeCapabilitiesPayload,
  decodeCharacteristicValue,
  decodeInputReportPayload,
  decodeOrientationPayload,
  encodeCapabilitiesPayload,
  encodeInputReportPayload,
  encodeOrientationPayload,
  toJoystickStates,
} from "../src/index.js";

const orientation = {
  t: 0x12345678,
  qw: 1,
  qx: -0.5,
  qy: 0.25,
  qz: -0.125,
  heading: 123.5,
  roll: -45.25,
  pitch: 12.0625,
  temp_c: -7,
  cal: { sys: 3, gyro: 2, accel: 1, mag: 0 },
};

test("orientation payload round-trips through the wire format", () => {
  const payload = encodeOrientationPayload(orientation);

  assert.equal(payload.byteLength, 20);
  assert.deepEqual([...payload], [
    0x78, 0x56, 0x34, 0x12,
    0x00, 0x40, 0x00, 0xe0,
    0x00, 0x10, 0x00, 0xf8,
    0xb8, 0x07, 0x2c, 0xfd,
    0xc1, 0x00, 0xf9, 0xe4,
  ]);
  assert.deepEqual(decodeOrientationPayload(payload), {
    type: "imu",
    ...orientation,
  });
});

test("decoders honor a typed array's byte offset", () => {
  const encoded = encodeOrientationPayload(orientation);
  const storage = new Uint8Array(24);
  storage.set(encoded, 2);

  assert.deepEqual(
    decodeOrientationPayload(storage.subarray(2, 22)),
    { type: "imu", ...orientation }
  );
});

test("capabilities describe variable input counts", () => {
  const payload = encodeCapabilitiesPayload({
    axisCount: 8,
    buttonCount: 7,
    joystickCount: 3,
  });

  assert.deepEqual([...payload], [2, 1, 8, 7, 3, 0, 0, 0]);
  assert.deepEqual(decodeCapabilitiesPayload(payload), {
    type: "capabilities",
    protocolVersion: 2,
    reportVersion: 1,
    axisCount: 8,
    buttonCount: 7,
    joystickCount: 3,
  });
});

test("axis input reports support offsets and the 20-byte BLE limit", () => {
  const report = {
    reportType: "axes",
    t: 0x01020304,
    offset: 4,
    values: [0.5, -1, 0, 0.25, 1, -0.5],
  };
  const payload = encodeInputReportPayload(report);

  assert.equal(payload.byteLength, 20);
  const decoded = decodeInputReportPayload(payload);
  assert.equal(decoded.reportType, "axes");
  assert.equal(decoded.offset, 4);
  assert.equal(decoded.values.length, 6);
  assert.ok(Math.abs(decoded.values[0] - 0.5) < 0.0001);
  assert.equal(decoded.values[1], -1);
  assert.equal(decoded.values[4], 1);
});

test("button input reports bit-pack arbitrary button banks", () => {
  const values = Array.from({ length: 17 }, (_, index) =>
    [0, 7, 8, 16].includes(index)
  );
  const payload = encodeInputReportPayload({
    reportType: "buttons",
    t: 123,
    offset: 12,
    values,
  });

  assert.equal(payload.byteLength, 11);
  assert.deepEqual(decodeInputReportPayload(payload), {
    type: "input-report",
    reportType: "buttons",
    t: 123,
    offset: 12,
    values,
  });
});

test("input reports update immutable React-friendly state", () => {
  const initial = createInputState({
    axisCount: 4,
    buttonCount: 3,
    joystickCount: 2,
  });
  const withAxes = applyInputReport(initial, {
    type: "input-report",
    reportType: "axes",
    t: 10,
    offset: 0,
    values: [0.5, -0.25, 1, 0],
  });
  const complete = applyInputReport(withAxes, {
    type: "input-report",
    reportType: "buttons",
    t: 10,
    offset: 0,
    values: [true, false, true],
  });

  assert.notEqual(withAxes, initial);
  assert.deepEqual(initial.axes, [0, 0, 0, 0]);
  assert.deepEqual(complete.buttons, [true, false, true]);
  assert.deepEqual(toJoystickStates(complete), [
    { x: 0.5, y: -0.25, pressed: true },
    { x: 1, y: 0, pressed: false },
  ]);
});

test("characteristic decoder dispatches by UUID case-insensitively", () => {
  const capabilitiesPayload = encodeCapabilitiesPayload({
    axisCount: 4,
    buttonCount: 3,
    joystickCount: 2,
  });
  assert.equal(
    decodeCharacteristicValue(
      BLE.capabilitiesCharacteristicUuid.toUpperCase(),
      capabilitiesPayload
    ).type,
    "capabilities"
  );

  const inputPayload = encodeInputReportPayload({
    reportType: "buttons",
    t: 1,
    offset: 0,
    values: [true, false, true],
  });
  assert.equal(
    decodeCharacteristicValue(
      BLE.inputCharacteristicUuid.toUpperCase(),
      inputPayload
    ).type,
    "input-report"
  );
});

test("fixed-length packets reject truncated or extended input", () => {
  for (const payload of [new Uint8Array(19), new Uint8Array(21)]) {
    assert.throws(
      () => decodeOrientationPayload(payload),
      (error) =>
        error instanceof DendenProtocolError &&
        error.code === "INVALID_PAYLOAD_LENGTH" &&
        error.expectedLength === 20 &&
        error.actualLength === payload.byteLength
    );
  }
});

test("encoders reject values that do not fit on the wire", () => {
  assert.throws(
    () => encodeOrientationPayload({ ...orientation, temp_c: 128 }),
    (error) =>
      error instanceof DendenProtocolError &&
      error.code === "INVALID_FIELD" &&
      error.field === "temp_c"
  );
  assert.throws(
    () =>
      encodeInputReportPayload({
        reportType: "axes",
        t: 1,
        offset: 0,
        values: [1.1],
      }),
    (error) =>
      error instanceof DendenProtocolError &&
      error.code === "INVALID_FIELD" &&
      error.field === "values[0]"
  );
  assert.throws(
    () =>
      encodeCapabilitiesPayload({
        axisCount: 2,
        buttonCount: 2,
        joystickCount: 2,
      }),
    (error) =>
      error instanceof DendenProtocolError &&
      error.code === "INVALID_FIELD" &&
      error.field === "axisCount"
  );
  assert.throws(
    () =>
      decodeInputReportPayload(
        new Uint8Array([0, 0, 0, 0, 1, 1, 0, 6])
      ),
    (error) =>
      error instanceof DendenProtocolError &&
      error.code === "INVALID_PAYLOAD_LENGTH"
  );
});
