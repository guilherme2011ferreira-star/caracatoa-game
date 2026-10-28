const REQUEST_BODY_SIZE = 32;
const CLINE_VERSION_BASE = 0xfb8c;

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('packet body precisa ser Buffer ou Uint8Array.');
}

export function computeWyd727ClineVersion(shift) {
  if (!Number.isInteger(shift) || shift < 1 || shift > 9) {
    throw new RangeError('CLIVER shift precisa ficar entre 1 e 9.');
  }
  return (shift + (CLINE_VERSION_BASE << shift) * 10) >>> 0;
}

/** Parse the 32 decoded body bytes after the four-byte framing prefix. */
export function parseWyd727CharacterEntryRequest(input) {
  const body = asBytes(input);
  if (body.length !== REQUEST_BODY_SIZE || body.readUInt16LE(0) !== 0x213) {
    return { malformed: true };
  }

  const clientId = body.readUInt16LE(2);
  const slot = body.readInt32LE(8);
  const reserved = body.subarray(12, 16);
  const clineVersion = body.readUInt32LE(16);
  const padding = body.subarray(20, 32);
  const shift = clineVersion % 10;

  return {
    malformed: false,
    clientId,
    slot,
    shift,
    clineVersion,
    versionValid: shift >= 1 && shift <= 9 &&
      clineVersion === computeWyd727ClineVersion(shift),
    reservedValid: reserved.every((byte) => byte === 0),
    paddingValid: padding.every((byte) => byte === 0),
  };
}
