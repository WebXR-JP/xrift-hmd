import assert from "node:assert/strict";
import test from "node:test";

import {
  BLE,
  DendenProtocolError,
  decodeButtonPayload,
  decodeCharacteristicValue,
  decodeJoystickPayload,
  decodeOrientationPayload,
  encodeButtonPayload,
  encodeJoystickPayload,
  encodeOrientationPayload,
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

test("orientation payload round-trips through the v1 wire format", () => {
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

test("button payload round-trips and leaves reserved byte zeroed", () => {
  const packet = { t: 9876, pressed: true, press_count: 42 };
  const payload = encodeButtonPayload(packet);

  assert.deepEqual([...payload], [
    0x94, 0x26, 0x00, 0x00,
    0x01, 0x00, 0x2a, 0x00,
  ]);
  assert.deepEqual(decodeButtonPayload(payload), {
    type: "button",
    ...packet,
  });
});

test("joystick payload encodes two normalized axes and button flags", () => {
  const packet = {
    t: 0x01020304,
    joysticks: [
      { x: 0.5, y: -1, pressed: true },
      { x: 0, y: 0.25, pressed: false },
    ],
  };
  const payload = encodeJoystickPayload(packet);

  assert.deepEqual([...payload], [
    0x04, 0x03, 0x02, 0x01,
    0x00, 0x40, 0x01, 0x80,
    0x00, 0x00, 0x00, 0x20,
    0x01, 0x00,
  ]);

  const decoded = decodeJoystickPayload(payload);
  assert.equal(decoded.type, "joystick");
  assert.equal(decoded.t, packet.t);
  assert.equal(decoded.joysticks[0].pressed, true);
  assert.equal(decoded.joysticks[1].pressed, false);
  assert.ok(Math.abs(decoded.joysticks[0].x - 0.5) < 0.0001);
  assert.equal(decoded.joysticks[0].y, -1);
  assert.equal(decoded.joysticks[1].x, 0);
  assert.ok(Math.abs(decoded.joysticks[1].y - 0.25) < 0.0001);
});

test("characteristic decoder dispatches by UUID case-insensitively", () => {
  const buttonPayload = encodeButtonPayload({
    t: 1,
    pressed: false,
    press_count: 2,
  });

  assert.equal(
    decodeCharacteristicValue(
      BLE.buttonCharacteristicUuid.toUpperCase(),
      buttonPayload
    ).type,
    "button"
  );

  const joystickPayload = encodeJoystickPayload({
    t: 1,
    joysticks: [
      { x: 0, y: 0, pressed: false },
      { x: 0, y: 0, pressed: false },
    ],
  });
  assert.equal(
    decodeCharacteristicValue(
      BLE.joystickCharacteristicUuid.toUpperCase(),
      joystickPayload
    ).type,
    "joystick"
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
      encodeJoystickPayload({
        t: 1,
        joysticks: [
          { x: 1.1, y: 0, pressed: false },
          { x: 0, y: 0, pressed: false },
        ],
      }),
    (error) =>
      error instanceof DendenProtocolError &&
      error.code === "INVALID_FIELD" &&
      error.field === "joysticks[0].x"
  );
});
