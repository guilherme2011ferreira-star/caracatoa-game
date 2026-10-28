import { inspectWyd727ClientFrame } from './wyd-727-profile.mjs';

const LOGIN_OPCODE = 0x20d;
const LOGIN_PASSWORD_OFFSET = 8;
const LOGIN_PASSWORD_SIZE = 12;
const LOGIN_ACCOUNT_OFFSET = LOGIN_PASSWORD_OFFSET + LOGIN_PASSWORD_SIZE;
const LOGIN_ACCOUNT_SIZE = 16;

function readFixedAscii(field, { secret = false } = {}) {
  const terminator = field.indexOf(0);
  if (terminator < 0) return null;
  for (let i = terminator; i < field.length; i += 1) {
    if (field[i] !== 0) return null;
  }
  const value = field.subarray(0, terminator);
  if (value.some((byte) => byte < 0x20 || byte > 0x7e)) return null;
  return secret ? Buffer.from(value) : value.toString('ascii');
}

/**
 * Authenticate a decrypted WYD frame body from 0x20D. It never returns or logs
 * the password, and clears the password bytes in the supplied body after use.
 */
export async function authenticateWyd727LoginPacket(accountStore, packetBody) {
  if (!Buffer.isBuffer(packetBody) && !(packetBody instanceof Uint8Array)) return null;
  const body = Buffer.isBuffer(packetBody)
    ? packetBody
    : Buffer.from(packetBody.buffer, packetBody.byteOffset, packetBody.byteLength);
  const passwordField = body.subarray(LOGIN_PASSWORD_OFFSET, LOGIN_PASSWORD_OFFSET + LOGIN_PASSWORD_SIZE);
  const inspected = inspectWyd727ClientFrame(body);
  if (!inspected.recognized || inspected.opcode !== LOGIN_OPCODE || inspected.lengthValid !== true ||
      body.length < LOGIN_ACCOUNT_OFFSET + LOGIN_ACCOUNT_SIZE) {
    passwordField.fill(0);
    return null;
  }

  const password = readFixedAscii(passwordField, { secret: true });
  const accountId = readFixedAscii(body.subarray(LOGIN_ACCOUNT_OFFSET, LOGIN_ACCOUNT_OFFSET + LOGIN_ACCOUNT_SIZE));
  try {
    if (!password || !accountId) return null;
    return await accountStore.authenticate(accountId, password);
  } finally {
    password?.fill(0);
    passwordField.fill(0);
  }
}
