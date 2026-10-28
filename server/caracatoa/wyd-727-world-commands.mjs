const KEEPALIVE_BODY_LENGTH = 8;
const MOVE_BODY_LENGTH = 48;
const MAX_MOVE_STEPS = 12;
const DIRECTION_DELTAS = new Map([
  [0x31, { x: -1, y: -1 }],
  [0x32, { x: 0, y: -1 }],
  [0x33, { x: 1, y: -1 }],
  [0x34, { x: -1, y: 0 }],
  [0x36, { x: 1, y: 0 }],
  [0x37, { x: -1, y: 1 }],
  [0x38, { x: 0, y: 1 }],
  [0x39, { x: 1, y: 1 }],
]);

function asBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('packet body precisa ser Buffer ou Uint8Array.');
}

function readPosition(body, offset) {
  return { x: body.readInt16LE(offset), y: body.readInt16LE(offset + 2) };
}

function writePosition(body, offset, position) {
  body.writeInt16LE(position.x, offset);
  body.writeInt16LE(position.y, offset + 2);
}

function isPosition(value) {
  return value && Number.isInteger(value.x) && value.x >= -0x8000 && value.x <= 0x7fff &&
    Number.isInteger(value.y) && value.y >= -0x8000 && value.y <= 0x7fff;
}

/** Parse the decoded 8-byte header body of the public WYDBot 0x3A0 signal. */
export function parseWyd727KeepAliveRequest(input) {
  const body = asBytes(input);
  if (body.length !== KEEPALIVE_BODY_LENGTH || body.readUInt16LE(0) !== 0x3a0) {
    return { malformed: true };
  }
  return { malformed: false, clientId: body.readUInt16LE(2) };
}

/** Parse and replay the public WYDBot 0x36C path without trusting its destiny. */
export function parseWyd727MoveRequest(input) {
  const body = asBytes(input);
  if (body.length !== MOVE_BODY_LENGTH || body.readUInt16LE(0) !== 0x36c) {
    return { malformed: true };
  }

  const clientId = body.readUInt16LE(2);
  const lastPosition = readPosition(body, 8);
  const moveType = body.readUInt32LE(12);
  const requestedSpeed = body.readUInt32LE(16);
  const rawPath = body.subarray(20, 44);
  const destiny = readPosition(body, 44);
  const directionCodes = [];
  let paddingStarted = false;
  let x = lastPosition.x;
  let y = lastPosition.y;
  let invalidReason = null;

  for (const code of rawPath) {
    if (code === 0) {
      paddingStarted = true;
      continue;
    }
    if (paddingStarted) {
      invalidReason = 'nonzero-after-path-padding';
      break;
    }
    const delta = DIRECTION_DELTAS.get(code);
    if (!delta) {
      invalidReason = 'invalid-direction-code';
      break;
    }
    if (directionCodes.length >= MAX_MOVE_STEPS) {
      invalidReason = 'too-many-steps';
      break;
    }
    directionCodes.push(code);
    x += delta.x;
    y += delta.y;
    if (x < -0x8000 || x > 0x7fff || y < -0x8000 || y > 0x7fff) {
      invalidReason = 'position-out-of-range';
      break;
    }
  }

  if (directionCodes.length === 0 && invalidReason === null) invalidReason = 'empty-path';
  if (!invalidReason && (x !== destiny.x || y !== destiny.y)) invalidReason = 'destiny-does-not-match-path';
  if (!invalidReason && (moveType > 15 || requestedSpeed > 1000)) invalidReason = 'movement-parameter-out-of-range';

  return {
    malformed: false,
    clientId,
    lastPosition,
    moveType,
    requestedSpeed,
    directionCodes,
    destiny,
    pathValid: invalidReason === null,
    invalidReason,
    replayedDestiny: { x, y },
  };
}

/** Build the public 0x366 server movement response using the 0x36C layout. */
export function buildWyd727MoveResponseBody({
  clientId,
  timestamp = Date.now() >>> 0,
  lastPosition,
  destiny,
  moveType = 0,
  speedMove = 3,
  directionCodes = [],
}) {
  if (!Number.isInteger(clientId) || clientId < 1 || clientId > 0xffff) {
    throw new RangeError('clientId fora do intervalo aceito.');
  }
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff) {
    throw new RangeError('timestamp fora do intervalo aceito.');
  }
  if (!isPosition(lastPosition) || !isPosition(destiny)) {
    throw new RangeError('posições precisam ser coordenadas Int16 assinadas.');
  }
  if (!Number.isInteger(moveType) || moveType < 0 || moveType > 15) {
    throw new RangeError('moveType precisa ficar entre 0 e 15.');
  }
  if (!Number.isInteger(speedMove) || speedMove < 1 || speedMove > 7) {
    throw new RangeError('speedMove autoritativo precisa ficar entre 1 e 7.');
  }
  if (!Array.isArray(directionCodes) || directionCodes.length > MAX_MOVE_STEPS ||
      directionCodes.some((code) => !DIRECTION_DELTAS.has(code))) {
    throw new RangeError('directionCodes precisa conter até 12 direções WYD válidas.');
  }

  const body = Buffer.alloc(MOVE_BODY_LENGTH);
  body.writeUInt16LE(0x366, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  writePosition(body, 8, lastPosition);
  body.writeUInt32LE(moveType, 12);
  body.writeUInt32LE(speedMove, 16);
  directionCodes.forEach((code, index) => body.writeUInt8(code, 20 + index));
  writePosition(body, 44, destiny);
  return body;
}
