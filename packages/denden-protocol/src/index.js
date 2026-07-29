export const PROTOCOL_VERSION = 2;
export const INPUT_REPORT_VERSION = 1;

export const ORIENTATION_PAYLOAD_LENGTH = 20;
export const CAPABILITIES_PAYLOAD_LENGTH = 8;
export const INPUT_REPORT_HEADER_LENGTH = 8;
export const INPUT_REPORT_MAX_LENGTH = 20;
export const INPUT_REPORT_MAX_AXES = 6;
export const INPUT_REPORT_MAX_BUTTONS = 96;
export const QUATERNION_SCALE = 16384;
export const EULER_SCALE = 16;
export const INPUT_AXIS_SCALE = 32767;

export const INPUT_REPORT_KIND = Object.freeze({
  axes: 1,
  buttons: 2,
});

export const BLE = Object.freeze({
  deviceName: "DENDEN-VR",
  serviceUuid: "f3641400-00b0-4240-ba50-05ca45bf8abc",
  orientationCharacteristicUuid: "f3641401-00b0-4240-ba50-05ca45bf8abc",
  capabilitiesCharacteristicUuid: "f3641402-00b0-4240-ba50-05ca45bf8abc",
  inputCharacteristicUuid: "f3641403-00b0-4240-ba50-05ca45bf8abc",
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

  if (expectedLength !== undefined && view.byteLength !== expectedLength) {
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

function encodeInputAxis(value, fieldName) {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      `${fieldName} must be a finite number from -1 to 1`,
      { field: fieldName, value }
    );
  }
  return Math.round(value * INPUT_AXIS_SCALE);
}

function validateCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== "object") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "capabilities must be an object",
      { field: "capabilities", value: capabilities }
    );
  }

  assertIntegerInRange(capabilities.axisCount, 0, 255, "axisCount");
  assertIntegerInRange(capabilities.buttonCount, 0, 255, "buttonCount");
  assertIntegerInRange(capabilities.joystickCount, 0, 127, "joystickCount");
  if (capabilities.joystickCount * 2 > capabilities.axisCount) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "axisCount must provide two axes for every joystick",
      { field: "axisCount", value: capabilities.axisCount }
    );
  }
  if (capabilities.joystickCount > capabilities.buttonCount) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "buttonCount must provide one button for every joystick",
      { field: "buttonCount", value: capabilities.buttonCount }
    );
  }
}

export function decodeCapabilitiesPayload(payload) {
  const view = toDataView(
    payload,
    "capabilities",
    CAPABILITIES_PAYLOAD_LENGTH
  );
  const protocolVersion = view.getUint8(0);
  const reportVersion = view.getUint8(1);
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new DendenProtocolError(
      "UNSUPPORTED_PROTOCOL_VERSION",
      `Unsupported protocol version: ${protocolVersion}`,
      { protocolVersion }
    );
  }
  if (reportVersion !== INPUT_REPORT_VERSION) {
    throw new DendenProtocolError(
      "UNSUPPORTED_REPORT_VERSION",
      `Unsupported input report version: ${reportVersion}`,
      { reportVersion }
    );
  }

  const capabilities = {
    type: "capabilities",
    protocolVersion,
    reportVersion,
    axisCount: view.getUint8(2),
    buttonCount: view.getUint8(3),
    joystickCount: view.getUint8(4),
  };
  validateCapabilities(capabilities);
  return capabilities;
}

export function encodeCapabilitiesPayload(capabilities) {
  validateCapabilities(capabilities);
  const protocolVersion =
    capabilities.protocolVersion ?? PROTOCOL_VERSION;
  const reportVersion =
    capabilities.reportVersion ?? INPUT_REPORT_VERSION;
  assertIntegerInRange(
    protocolVersion,
    PROTOCOL_VERSION,
    PROTOCOL_VERSION,
    "protocolVersion"
  );
  assertIntegerInRange(
    reportVersion,
    INPUT_REPORT_VERSION,
    INPUT_REPORT_VERSION,
    "reportVersion"
  );

  const payload = new Uint8Array(CAPABILITIES_PAYLOAD_LENGTH);
  payload[0] = protocolVersion;
  payload[1] = reportVersion;
  payload[2] = capabilities.axisCount;
  payload[3] = capabilities.buttonCount;
  payload[4] = capabilities.joystickCount;
  return payload;
}

function assertInputReport(report) {
  if (!report || typeof report !== "object") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "input report must be an object",
      { field: "report", value: report }
    );
  }
  assertIntegerInRange(report.t, 0, 0xffffffff, "t");
  assertIntegerInRange(report.offset, 0, 255, "offset");
  if (!Array.isArray(report.values) || report.values.length === 0) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "values must be a non-empty array",
      { field: "values", value: report.values }
    );
  }
}

export function decodeInputReportPayload(payload) {
  const view = toDataView(payload, "input report");
  if (
    view.byteLength < INPUT_REPORT_HEADER_LENGTH ||
    view.byteLength > INPUT_REPORT_MAX_LENGTH
  ) {
    throw new DendenProtocolError(
      "INVALID_PAYLOAD_LENGTH",
      `input report payload must be ${INPUT_REPORT_HEADER_LENGTH} to ${INPUT_REPORT_MAX_LENGTH} bytes; received ${view.byteLength}`,
      {
        minimumLength: INPUT_REPORT_HEADER_LENGTH,
        maximumLength: INPUT_REPORT_MAX_LENGTH,
        actualLength: view.byteLength,
      }
    );
  }

  const reportVersion = view.getUint8(4);
  if (reportVersion !== INPUT_REPORT_VERSION) {
    throw new DendenProtocolError(
      "UNSUPPORTED_REPORT_VERSION",
      `Unsupported input report version: ${reportVersion}`,
      { reportVersion }
    );
  }

  const kind = view.getUint8(5);
  const offset = view.getUint8(6);
  const count = view.getUint8(7);
  let reportType;
  let expectedLength;
  let values;

  if (kind === INPUT_REPORT_KIND.axes) {
    reportType = "axes";
    if (count < 1 || count > INPUT_REPORT_MAX_AXES) {
      throw new DendenProtocolError(
        "INVALID_FIELD",
        `axis count must be from 1 to ${INPUT_REPORT_MAX_AXES}`,
        { field: "count", value: count }
      );
    }
    expectedLength = INPUT_REPORT_HEADER_LENGTH + count * 2;
    if (view.byteLength === expectedLength) {
      values = Array.from(
        { length: count },
        (_, index) =>
          Math.max(
            -1,
            view.getInt16(INPUT_REPORT_HEADER_LENGTH + index * 2, true) /
              INPUT_AXIS_SCALE
          )
      );
    }
  } else if (kind === INPUT_REPORT_KIND.buttons) {
    reportType = "buttons";
    if (count < 1 || count > INPUT_REPORT_MAX_BUTTONS) {
      throw new DendenProtocolError(
        "INVALID_FIELD",
        `button count must be from 1 to ${INPUT_REPORT_MAX_BUTTONS}`,
        { field: "count", value: count }
      );
    }
    expectedLength = INPUT_REPORT_HEADER_LENGTH + Math.ceil(count / 8);
    if (view.byteLength === expectedLength) {
      values = Array.from(
        { length: count },
        (_, index) =>
          (view.getUint8(INPUT_REPORT_HEADER_LENGTH + (index >> 3)) &
            (1 << (index & 0x07))) !==
          0
      );
    }
  } else {
    throw new DendenProtocolError(
      "UNKNOWN_REPORT_KIND",
      `Unknown input report kind: ${kind}`,
      { kind }
    );
  }

  if (view.byteLength !== expectedLength) {
    throw new DendenProtocolError(
      "INVALID_PAYLOAD_LENGTH",
      `input ${reportType} report must be exactly ${expectedLength} bytes; received ${view.byteLength}`,
      { expectedLength, actualLength: view.byteLength }
    );
  }

  return {
    type: "input-report",
    reportType,
    t: view.getUint32(0, true),
    offset,
    values,
  };
}

export function encodeInputReportPayload(report) {
  assertInputReport(report);
  const isAxes = report.reportType === "axes";
  const isButtons = report.reportType === "buttons";
  if (!isAxes && !isButtons) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      'reportType must be "axes" or "buttons"',
      { field: "reportType", value: report.reportType }
    );
  }

  const maximum = isAxes
    ? INPUT_REPORT_MAX_AXES
    : INPUT_REPORT_MAX_BUTTONS;
  if (report.values.length > maximum) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      `${report.reportType} values must contain at most ${maximum} entries`,
      { field: "values", value: report.values }
    );
  }
  if (report.offset + report.values.length > 256) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "offset and values exceed the 8-bit input index range",
      { field: "offset", value: report.offset }
    );
  }

  const dataLength = isAxes
    ? report.values.length * 2
    : Math.ceil(report.values.length / 8);
  const payload = new Uint8Array(INPUT_REPORT_HEADER_LENGTH + dataLength);
  const view = new DataView(payload.buffer);
  view.setUint32(0, report.t, true);
  view.setUint8(4, INPUT_REPORT_VERSION);
  view.setUint8(
    5,
    isAxes ? INPUT_REPORT_KIND.axes : INPUT_REPORT_KIND.buttons
  );
  view.setUint8(6, report.offset);
  view.setUint8(7, report.values.length);

  report.values.forEach((value, index) => {
    if (isAxes) {
      view.setInt16(
        INPUT_REPORT_HEADER_LENGTH + index * 2,
        encodeInputAxis(value, `values[${index}]`),
        true
      );
      return;
    }
    if (typeof value !== "boolean") {
      throw new DendenProtocolError(
        "INVALID_FIELD",
        `values[${index}] must be a boolean`,
        { field: `values[${index}]`, value }
      );
    }
    if (value) {
      payload[INPUT_REPORT_HEADER_LENGTH + (index >> 3)] |=
        1 << (index & 0x07);
    }
  });

  return payload;
}

export function createInputState(capabilities) {
  validateCapabilities(capabilities);
  return {
    type: "input",
    t: 0,
    axes: Array(capabilities.axisCount).fill(0),
    buttons: Array(capabilities.buttonCount).fill(false),
    joystickCount: capabilities.joystickCount,
  };
}

export function applyInputReport(state, report) {
  if (!state || state.type !== "input") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "state must be a DENDEN input state",
      { field: "state", value: state }
    );
  }
  assertInputReport(report);
  const field = report.reportType;
  if (field !== "axes" && field !== "buttons") {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      'reportType must be "axes" or "buttons"',
      { field: "reportType", value: field }
    );
  }

  report.values.forEach((value, index) => {
    if (field === "axes") {
      encodeInputAxis(value, `values[${index}]`);
    } else if (typeof value !== "boolean") {
      throw new DendenProtocolError(
        "INVALID_FIELD",
        `values[${index}] must be a boolean`,
        { field: `values[${index}]`, value }
      );
    }
  });

  const currentValues = state[field];
  if (
    !Array.isArray(currentValues) ||
    report.offset + report.values.length > currentValues.length
  ) {
    throw new DendenProtocolError(
      "REPORT_OUT_OF_RANGE",
      `${field} report exceeds the advertised capabilities`,
      {
        field,
        offset: report.offset,
        count: report.values.length,
        available: currentValues?.length,
      }
    );
  }

  const nextValues = currentValues.slice();
  nextValues.splice(report.offset, report.values.length, ...report.values);
  return {
    ...state,
    t: report.t,
    [field]: nextValues,
  };
}

export function toJoystickStates(state) {
  if (
    !state ||
    !Array.isArray(state.axes) ||
    !Array.isArray(state.buttons) ||
    !Number.isInteger(state.joystickCount) ||
    state.joystickCount < 0 ||
    state.joystickCount * 2 > state.axes.length ||
    state.joystickCount > state.buttons.length
  ) {
    throw new DendenProtocolError(
      "INVALID_FIELD",
      "state must be a DENDEN input state",
      { field: "state", value: state }
    );
  }

  return Array.from({ length: state.joystickCount }, (_, index) => ({
    x: state.axes[index * 2],
    y: state.axes[index * 2 + 1],
    pressed: state.buttons[index],
  }));
}

export function decodeCharacteristicValue(characteristicUuid, payload) {
  const uuid = String(characteristicUuid).toLowerCase();
  if (uuid === BLE.orientationCharacteristicUuid) {
    return decodeOrientationPayload(payload);
  }
  if (uuid === BLE.capabilitiesCharacteristicUuid) {
    return decodeCapabilitiesPayload(payload);
  }
  if (uuid === BLE.inputCharacteristicUuid) {
    return decodeInputReportPayload(payload);
  }

  throw new DendenProtocolError(
    "UNKNOWN_CHARACTERISTIC",
    `Unknown DENDEN VR characteristic: ${characteristicUuid}`,
    { characteristicUuid }
  );
}
