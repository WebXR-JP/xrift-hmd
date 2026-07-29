export type BinaryPayload = ArrayBuffer | ArrayBufferView;

export interface Calibration {
  sys: number;
  gyro: number;
  accel: number;
  mag: number;
}

export interface OrientationPacket {
  type: "imu";
  t: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  heading: number;
  roll: number;
  pitch: number;
  temp_c: number;
  cal: Calibration;
}

export type OrientationPacketInput = Omit<OrientationPacket, "type"> & {
  type?: "imu";
};

export interface JoystickState {
  x: number;
  y: number;
  pressed: boolean;
}

export interface Capabilities {
  type: "capabilities";
  protocolVersion: 2;
  reportVersion: 1;
  axisCount: number;
  buttonCount: number;
  joystickCount: number;
}

export type CapabilitiesInput = Omit<
  Capabilities,
  "type" | "protocolVersion" | "reportVersion"
> & {
  type?: "capabilities";
  protocolVersion?: 2;
  reportVersion?: 1;
};

export interface AxesInputReport {
  type: "input-report";
  reportType: "axes";
  t: number;
  offset: number;
  values: number[];
}

export interface ButtonsInputReport {
  type: "input-report";
  reportType: "buttons";
  t: number;
  offset: number;
  values: boolean[];
}

export type InputReport = AxesInputReport | ButtonsInputReport;
export type InputReportInput =
  | Omit<AxesInputReport, "type">
  | Omit<ButtonsInputReport, "type">;

export interface InputState {
  type: "input";
  t: number;
  axes: number[];
  buttons: boolean[];
  joystickCount: number;
}

export type DendenPacket =
  | OrientationPacket
  | Capabilities
  | InputReport;

export const PROTOCOL_VERSION: 2;
export const INPUT_REPORT_VERSION: 1;
export const ORIENTATION_PAYLOAD_LENGTH: 20;
export const CAPABILITIES_PAYLOAD_LENGTH: 8;
export const INPUT_REPORT_HEADER_LENGTH: 8;
export const INPUT_REPORT_MAX_LENGTH: 20;
export const INPUT_REPORT_MAX_AXES: 6;
export const INPUT_REPORT_MAX_BUTTONS: 96;
export const QUATERNION_SCALE: 16384;
export const EULER_SCALE: 16;
export const INPUT_AXIS_SCALE: 32767;
export const INPUT_REPORT_KIND: Readonly<{
  axes: 1;
  buttons: 2;
}>;

export const BLE: Readonly<{
  deviceName: "DENDEN-VR";
  serviceUuid: "f3641400-00b0-4240-ba50-05ca45bf8abc";
  orientationCharacteristicUuid: "f3641401-00b0-4240-ba50-05ca45bf8abc";
  capabilitiesCharacteristicUuid: "f3641402-00b0-4240-ba50-05ca45bf8abc";
  inputCharacteristicUuid: "f3641403-00b0-4240-ba50-05ca45bf8abc";
}>;

export class DendenProtocolError extends Error {
  readonly code: string;
  readonly expectedLength?: number;
  readonly actualLength?: number;
  readonly field?: string;
  readonly value?: unknown;
  readonly characteristicUuid?: unknown;
}

export function decodeCalibration(value: number): Calibration;
export function encodeCalibration(calibration: Calibration): number;
export function decodeOrientationPayload(
  payload: BinaryPayload
): OrientationPacket;
export function encodeOrientationPayload(
  packet: OrientationPacketInput
): Uint8Array;
export function decodeCapabilitiesPayload(
  payload: BinaryPayload
): Capabilities;
export function encodeCapabilitiesPayload(
  capabilities: CapabilitiesInput
): Uint8Array;
export function decodeInputReportPayload(
  payload: BinaryPayload
): InputReport;
export function encodeInputReportPayload(
  report: InputReportInput
): Uint8Array;
export function createInputState(
  capabilities: Pick<
    Capabilities,
    "axisCount" | "buttonCount" | "joystickCount"
  >
): InputState;
export function applyInputReport(
  state: InputState,
  report: InputReport
): InputState;
export function toJoystickStates(state: InputState): JoystickState[];
export function decodeCharacteristicValue(
  characteristicUuid: string,
  payload: BinaryPayload
): DendenPacket;
