import { inspectWyd727ClientFrame } from './wyd-727-profile.mjs';

const TOKEN_OPCODE = 0xfde;
const TOKEN_OFFSET = 8;
const TOKEN_SIZE = 6;
const TOKEN_CHANGE_OFFSET = 24;

function readToken(field) {
  const terminator = field.indexOf(0);
  const length = terminator < 0 ? field.length : terminator;
  if (length < 4 || length > 6) return null;
  for (let i = length; i < field.length; i += 1) if (field[i] !== 0) return null;
  const value = field.subarray(0, length);
  if (value.some((byte) => byte < 0x30 || byte > 0x39)) return null;
  return Buffer.from(value);
}

/** Authenticate a decrypted login-token frame against the account already bound to this session. */
export async function authenticateWyd727TokenPacket(accountStore, accountId, packetBody) {
  if (!Buffer.isBuffer(packetBody) && !(packetBody instanceof Uint8Array)) return null;
  const body = Buffer.isBuffer(packetBody)
    ? packetBody
    : Buffer.from(packetBody.buffer, packetBody.byteOffset, packetBody.byteLength);
  const field = body.subarray(TOKEN_OFFSET, TOKEN_OFFSET + TOKEN_SIZE);
  const inspected = inspectWyd727ClientFrame(body);
  if (!inspected.recognized || inspected.opcode !== TOKEN_OPCODE || inspected.lengthValid !== true ||
      body.length < TOKEN_CHANGE_OFFSET + 4) {
    field.fill(0);
    return null;
  }

  const token = readToken(field);
  try {
    if (!token || body.readInt32LE(TOKEN_CHANGE_OFFSET) !== 0) return null;
    return await accountStore.authenticateToken(accountId, token);
  } finally {
    token?.fill(0);
    field.fill(0);
  }
}
