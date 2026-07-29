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

export interface ButtonPacket {
  type: "button";
  t: number;
  pressed: boolean;
  press_count: number;
}

export type ButtonPacketInput = Omit<ButtonPacket, "type"> & {
  type?: "button";
};

export type DendenPacket = OrientationPacket | ButtonPacket;

export const PROTOCOL_VERSION: 1;
export const ORIENTATION_PAYLOAD_LENGTH: 20;
export const BUTTON_PAYLOAD_LENGTH: 8;
export const QUATERNION_SCALE: 16384;
export const EULER_SCALE: 16;

export const BLE: Readonly<{
  deviceName: "DENDEN-VR";
  serviceUuid: "f3641400-00b0-4240-ba50-05ca45bf8abc";
  orientationCharacteristicUuid: "f3641401-00b0-4240-ba50-05ca45bf8abc";
  buttonCharacteristicUuid: "f3641402-00b0-4240-ba50-05ca45bf8abc";
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
export function decodeButtonPayload(payload: BinaryPayload): ButtonPacket;
export function encodeButtonPayload(packet: ButtonPacketInput): Uint8Array;
export function decodeCharacteristicValue(
  characteristicUuid: string,
  payload: BinaryPayload
): DendenPacket;
