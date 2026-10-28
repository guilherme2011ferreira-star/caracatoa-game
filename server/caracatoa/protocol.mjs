import { readFileSync } from 'node:fs';

const TABLES = JSON.parse(readFileSync(
  new URL('./protocol-tables.json', import.meta.url),
  'utf8',
));
const TABLE_A = TABLES.tableA;
const TABLE_B = TABLES.tableB;
const HEADER_SIZE = 4;
const MIN_FRAME_SIZE = 12;
const MAX_FRAME_SIZE = 0xffff;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const CLIENT_HANDSHAKE = Buffer.from([0x11, 0xf3, 0x11, 0x1f]);

if (TABLE_A.length !== 256 || TABLE_B.length !== 256 ||
    [...TABLE_A, ...TABLE_B].some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
  throw new Error('Tabelas do codec WYD inválidas.');
}

function decodeByte(wire, key, position) {
  switch (position & 3) {
    case 0: return (wire - key * 2) & 0xff;
    case 1: return (wire + (key >> 3)) & 0xff;
    case 2: return (wire - key * 4) & 0xff;
    default: return (wire + (key >> 5)) & 0xff;
  }
}

function encodeByte(plain, key, position) {
  switch (position & 3) {
    case 0: return (plain + key * 2) & 0xff;
    case 1: return (plain - (key >> 3)) & 0xff;
    case 2: return (plain + key * 4) & 0xff;
    default: return (plain - (key >> 5)) & 0xff;
  }
}

function asBytes(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} precisa ser Buffer ou Uint8Array.`);
}

/** Decode exactly one complete frame, including its four-byte header. */
export function decodeFrame(input) {
  const wire = asBytes(input, 'frame');
  if (wire.length < HEADER_SIZE) return { ok: false, error: 'frame shorter than header' };
  const declaredLength = wire.readUInt16LE(0);
  if (declaredLength !== wire.length) return { ok: false, error: 'declared length does not match frame size' };
  if (declaredLength < MIN_FRAME_SIZE) return { ok: false, error: 'frame length outside observed bounds' };

  const sequence = wire[2];
  const body = Buffer.allocUnsafe(wire.length - HEADER_SIZE);
  const initialKey = TABLE_A[sequence];
  let wireSum = 0;
  let plainSum = 0;
  for (let offset = 0; offset < body.length; offset += 1) {
    const position = offset + HEADER_SIZE;
    const keyIndex = (initialKey + offset) & 0xff;
    const wireByte = wire[position];
    const plainByte = decodeByte(wireByte, TABLE_B[keyIndex], position);
    body[offset] = plainByte;
    wireSum += wireByte;
    plainSum += plainByte;
  }
  if (((wireSum - plainSum) & 0xff) !== wire[3]) {
    return { ok: false, error: 'frame checksum mismatch' };
  }
  return { ok: true, frame: { sequence, body } };
}

/** Encode one body using the caller-selected one-byte sequence seed. */
export function encodeFrame(input, sequence) {
  const body = asBytes(input, 'body');
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xff) {
    throw new RangeError('sequence deve estar entre 0 e 255.');
  }
  const frameLength = body.length + HEADER_SIZE;
  if (frameLength < MIN_FRAME_SIZE || frameLength > MAX_FRAME_SIZE) {
    throw new RangeError('frame length outside observed bounds');
  }

  const wire = Buffer.alloc(frameLength);
  wire.writeUInt16LE(frameLength, 0);
  wire[2] = sequence;
  const initialKey = TABLE_A[sequence];
  let wireSum = 0;
  let plainSum = 0;
  for (let offset = 0; offset < body.length; offset += 1) {
    const position = offset + HEADER_SIZE;
    const keyIndex = (initialKey + offset) & 0xff;
    const encoded = encodeByte(body[offset], TABLE_B[keyIndex], position);
    wire[position] = encoded;
    wireSum += encoded;
    plainSum += body[offset];
  }
  wire[3] = (wireSum - plainSum) & 0xff;
  return wire;
}

/** The four-byte marker sent by the client once after opening TCP. */
export function clientHandshake() {
  return Buffer.from(CLIENT_HANDSHAKE);
}

/** Incremental client-to-server parser for fragmented and coalesced TCP data. */
export class StreamDecoder {
  #handshakeDone;
  #failed = false;
  #buffer = Buffer.alloc(0);

  constructor({ expectHandshake = true, maxBufferedBytes = MAX_BUFFERED_BYTES } = {}) {
    if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes < MAX_FRAME_SIZE + CLIENT_HANDSHAKE.length ||
        maxBufferedBytes > 16 * 1024 * 1024) {
      throw new RangeError('maxBufferedBytes deve ficar entre 65539 e 16777216.');
    }
    this.#handshakeDone = !Boolean(expectHandshake);
    this.maxBufferedBytes = maxBufferedBytes;
  }

  feed(input) {
    if (this.#failed) return { frames: [], handshakeCompleted: false, error: 'decoder is in failed state' };
    const incoming = asBytes(input, 'data');
    if (incoming.length + this.#buffer.length > this.maxBufferedBytes) {
      this.#failed = true;
      return { frames: [], handshakeCompleted: false, error: 'buffered TCP data exceeds configured limit' };
    }

    const data = this.#buffer.length === 0
      ? incoming
      : Buffer.concat([this.#buffer, incoming]);
    let offset = 0;
    let handshakeCompleted = false;
    if (!this.#handshakeDone) {
      if (data.length < CLIENT_HANDSHAKE.length) {
        this.#buffer = Buffer.from(data);
        return { frames: [], handshakeCompleted: false, error: '' };
      }
      if (!data.subarray(0, CLIENT_HANDSHAKE.length).equals(CLIENT_HANDSHAKE)) {
        this.#failed = true;
        this.#buffer = Buffer.alloc(0);
        return { frames: [], handshakeCompleted: false, error: 'unexpected client handshake' };
      }
      offset = CLIENT_HANDSHAKE.length;
      this.#handshakeDone = true;
      handshakeCompleted = true;
    }

    const frames = [];
    while (data.length - offset >= 2) {
      const declaredLength = data.readUInt16LE(offset);
      if (declaredLength < MIN_FRAME_SIZE) {
        this.#failed = true;
        this.#buffer = Buffer.alloc(0);
        return { frames: [], handshakeCompleted, error: 'invalid frame length in TCP stream' };
      }
      if (data.length - offset < declaredLength) break;
      const decoded = decodeFrame(data.subarray(offset, offset + declaredLength));
      if (!decoded.ok) {
        this.#failed = true;
        this.#buffer = Buffer.alloc(0);
        return { frames: [], handshakeCompleted, error: decoded.error };
      }
      frames.push(decoded.frame);
      offset += declaredLength;
    }
    this.#buffer = Buffer.from(data.subarray(offset));
    return { frames, handshakeCompleted, error: '' };
  }

  failed() {
    return this.#failed;
  }

  finish() {
    if (this.#failed) return 'decoder is in failed state';
    if (!this.#handshakeDone) return 'TCP stream ended before the client handshake';
    if (this.#buffer.length !== 0) return 'TCP stream ended with an incomplete frame';
    return '';
  }
}
