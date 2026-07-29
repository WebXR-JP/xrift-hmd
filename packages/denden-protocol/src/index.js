export const PROTOCOL_VERSION = 1;

export const ORIENTATION_PAYLOAD_LENGTH = 20;
export const BUTTON_PAYLOAD_LENGTH = 8;
export const JOYSTICK_PAYLOAD_LENGTH = 14;
export const QUATERNION_SCALE = 16384;
export const EULER_SCALE = 16;
export const JOYSTICK_AXIS_SCALE = 32767;

export const BLE = Object.freeze({
  deviceName: "DENDEN-VR",
  serviceUuid: "f3641400-00b0-4240-ba50-05ca45bf8abc",
  orientationCharacteristicUuid: "f3641401-00b0-4240-ba50-05ca45bf8abc",
  buttonCharacteristicUuid: "f3641402-00b0-4240-ba50-05ca45bf8abc",
  joystickCharacteristicUuid: "f3641403-00b0-4240-ba50-05ca45bf8abc",
});

export class DendenProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DendenProtocolError";
    this.code = code;
    Object.assign(this, details);
  }
}

function toDataView(payload, packetName, expectedLength) {
  let view;

  if (payload instanceof DataView) {
    view = payload;
  } else if (ArrayBuffer.isView(payload)) {
    view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  } else if (
    payload instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== "undefined" &&
      payload instanceof SharedArrayBuffer)
  ) {
    view = new DataView(payload);
  } else {
    throw new DendenProtocolError(
      "INVALID_PAYLOAD_TYPE",
      `${packetName} payload must be an ArrayBuffer, DataView, or typed array`
    );
  }

  if (view.byteLength !== expectedLength) {
    throw new DendenProtocolError(
      "INVALID_PAYLOAD_LENGTH",
      `${packetName} payload must be exactly ${expectedLength} bytes; received ${view.byteLength}`,
      { expectedLength, actualLength: view.byteLength }
    );
  }

  return view;
}

function assertIntegerInRange(value, minimum, maximum, fieldName) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      `${fieldName} must be an integer from ${minimum} to ${maximum}`,
      { field: fieldName, value }
    );
  }
}

function encodeScaledInt16(value, scale, fieldName) {
  if (!Number.isFinite(value)) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      `${fieldName} must be a finite number`,
      { field: fieldName, value }
    );
  }

  const encoded = Math.round(value * scale);
  assertIntegerInRange(encoded, -32768, 32767, fieldName);
  return encoded;
}

export function decodeCalibration(value) {
  assertIntegerInRange(value, 0, 255, "calibration");
  return {
    sys: (value >> 6) & 0x03,
    gyro: (value >> 4) & 0x03,
    accel: (value >> 2) & 0x03,
    mag: value & 0x03,
  };
}

export function encodeCalibration(calibration) {
  if (!calibration || typeof calibration !== "object") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "calibration must be an object",
      { field: "calibration", value: calibration }
    );
  }

  assertIntegerInRange(calibration.sys, 0, 3, "cal.sys");
  assertIntegerInRange(calibration.gyro, 0, 3, "cal.gyro");
  assertIntegerInRange(calibration.accel, 0, 3, "cal.accel");
  assertIntegerInRange(calibration.mag, 0, 3, "cal.mag");

  return (
    (calibration.sys << 6) |
    (calibration.gyro << 4) |
    (calibration.accel << 2) |
    calibration.mag
  );
}

export function decodeOrientationPayload(payload) {
  const view = toDataView(
    payload,
    "orientation",
    ORIENTATION_PAYLOAD_LENGTH
  );

  return {
    type: "imu",
    t: view.getUint32(0, true),
    qw: view.getInt16(4, true) / QUATERNION_SCALE,
    qx: view.getInt16(6, true) / QUATERNION_SCALE,
    qy: view.getInt16(8, true) / QUATERNION_SCALE,
    qz: view.getInt16(10, true) / QUATERNION_SCALE,
    heading: view.getInt16(12, true) / EULER_SCALE,
    roll: view.getInt16(14, true) / EULER_SCALE,
    pitch: view.getInt16(16, true) / EULER_SCALE,
    temp_c: view.getInt8(18),
    cal: decodeCalibration(view.getUint8(19)),
  };
}

export function encodeOrientationPayload(packet) {
  if (!packet || typeof packet !== "object") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "orientation packet must be an object",
      { field: "packet", value: packet }
    );
  }

  assertIntegerInRange(packet.t, 0, 0xffffffff, "t");
  assertIntegerInRange(packet.temp_c, -128, 127, "temp_c");

  const payload = new Uint8Array(ORIENTATION_PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);
  view.setUint32(0, packet.t, true);
  view.setInt16(4, encodeScaledInt16(packet.qw, QUATERNION_SCALE, "qw"), true);
  view.setInt16(6, encodeScaledInt16(packet.qx, QUATERNION_SCALE, "qx"), true);
  view.setInt16(8, encodeScaledInt16(packet.qy, QUATERNION_SCALE, "qy"), true);
  view.setInt16(10, encodeScaledInt16(packet.qz, QUATERNION_SCALE, "qz"), true);
  view.setInt16(12, encodeScaledInt16(packet.heading, EULER_SCALE, "heading"), true);
  view.setInt16(14, encodeScaledInt16(packet.roll, EULER_SCALE, "roll"), true);
  view.setInt16(16, encodeScaledInt16(packet.pitch, EULER_SCALE, "pitch"), true);
  view.setInt8(18, packet.temp_c);
  view.setUint8(19, encodeCalibration(packet.cal));
  return payload;
}

export function decodeButtonPayload(payload) {
  const view = toDataView(payload, "button", BUTTON_PAYLOAD_LENGTH);
  return {
    type: "button",
    t: view.getUint32(0, true),
    pressed: (view.getUint8(4) & 0x01) !== 0,
    press_count: view.getUint16(6, true),
  };
}

export function encodeButtonPayload(packet) {
  if (!packet || typeof packet !== "object") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "button packet must be an object",
      { field: "packet", value: packet }
    );
  }

  assertIntegerInRange(packet.t, 0, 0xffffffff, "t");
  assertIntegerInRange(packet.press_count, 0, 0xffff, "press_count");
  if (typeof packet.pressed !== "boolean") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "pressed must be a boolean",
      { field: "pressed", value: packet.pressed }
    );
  }

  const payload = new Uint8Array(BUTTON_PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);
  view.setUint32(0, packet.t, true);
  view.setUint8(4, packet.pressed ? 0x01 : 0x00);
  view.setUint16(6, packet.press_count, true);
  return payload;
}

export function decodeJoystickPayload(payload) {
  const view = toDataView(payload, "joystick", JOYSTICK_PAYLOAD_LENGTH);
  const flags = view.getUint8(12);
  return {
    type: "joystick",
    t: view.getUint32(0, true),
    joysticks: [
      {
        x: Math.max(-1, view.getInt16(4, true) / JOYSTICK_AXIS_SCALE),
        y: Math.max(-1, view.getInt16(6, true) / JOYSTICK_AXIS_SCALE),
        pressed: (flags & 0x01) !== 0,
      },
      {
        x: Math.max(-1, view.getInt16(8, true) / JOYSTICK_AXIS_SCALE),
        y: Math.max(-1, view.getInt16(10, true) / JOYSTICK_AXIS_SCALE),
        pressed: (flags & 0x02) !== 0,
      },
    ],
  };
}

function encodeJoystickAxis(value, fieldName) {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      `${fieldName} must be a finite number from -1 to 1`,
      { field: fieldName, value }
    );
  }
  return Math.round(value * JOYSTICK_AXIS_SCALE);
}

export function encodeJoystickPayload(packet) {
  if (!packet || typeof packet !== "object") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "joystick packet must be an object",
      { field: "packet", value: packet }
    );
  }

  assertIntegerInRange(packet.t, 0, 0xffffffff, "t");
  if (!Array.isArray(packet.joysticks) || packet.joysticks.length !== 2) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "joysticks must contain exactly two entries",
      { field: "joysticks", value: packet.joysticks }
    );
  }

  const payload = new Uint8Array(JOYSTICK_PAYLOAD_LENGTH);
  const view = new DataView(payload.buffer);
  view.setUint32(0, packet.t, true);

  let flags = 0;
  packet.joysticks.forEach((joystick, index) => {
    if (!joystick || typeof joystick !== "object") {
      throw new DendenProtocolError(
        "INVALID_FIELD",
        `joysticks[${index}] must be an object`,
        { field: `joysticks[${index}]`, value: joystick }
      );
    }
    if (typeof joystick.pressed !== "boolean") {
      throw new DendenProtocolError(
        "INVALID_FIELD",
        `joysticks[${index}].pressed must be a boolean`,
        {
          field: `joysticks[${index}].pressed`,
          value: joystick.pressed,
        }
      );
    }

    const offset = 4 + index * 4;
    view.setInt16(
      offset,
      encodeJoystickAxis(joystick.x, `joysticks[${index}].x`),
      true
    );
    view.setInt16(
      offset + 2,
      encodeJoystickAxis(joystick.y, `joysticks[${index}].y`),
      true
    );
    if (joystick.pressed) {
      flags |= 1 << index;
    }
  });

  view.setUint8(12, flags);
  return payload;
}

export function decodeCharacteristicValue(characteristicUuid, payload) {
  const uuid = String(characteristicUuid).toLowerCase();
  if (uuid === BLE.orientationCharacteristicUuid) {
    return decodeOrientationPayload(payload);
  }
  if (uuid === BLE.buttonCharacteristicUuid) {
    return decodeButtonPayload(payload);
  }
  if (uuid === BLE.joystickCharacteristicUuid) {
    return decodeJoystickPayload(payload);
  }

  throw new DendenProtocolError(
    "UNKNOWN_CHARACTERISTIC",
    `Unknown DENDEN VR characteristic: ${characteristicUuid}`,
    { characteristicUuid }
  );
}
