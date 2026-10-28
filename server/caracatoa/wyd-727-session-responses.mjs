import { CARACATOA_CREATE_CHARACTER_STATUS } from './caracatoa-character-protocol.mjs';

export const CARACATOA_LOGIN_DENIED_CODE = 0x7fff;
export { CARACATOA_CREATE_CHARACTER_STATUS };

const CHARACTER_SLOT_COUNT = 4;
const SEL_CHAR_SIZE = 1208;
const SEL_CHAR_NAME_OFFSET = 16;
const SEL_CHAR_SCORE_OFFSET = 80;
const SEL_CHAR_EQUIP_OFFSET = 272;
const SEL_CHAR_EQUIP_SIZE = 216;
const SEL_CHAR_COIN_OFFSET = 1160;

function writeCharacterRoster(body, offset, characters) {
  if (offset < 0 || offset + SEL_CHAR_SIZE > body.length) {
    throw new RangeError('destino do roster excede o pacote.');
  }
  if (!Array.isArray(characters) || characters.length > CHARACTER_SLOT_COUNT) {
    throw new TypeError('characters precisa conter no máximo quatro personagens.');
  }
  const slots = new Set();
  for (const character of characters) {
    const { slot, name, classId, level, gold } = character ?? {};
    if (!Number.isInteger(slot) || slot < 0 || slot >= CHARACTER_SLOT_COUNT || slots.has(slot) ||
        typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(name) ||
        !Number.isInteger(classId) || classId < 0 || classId > 3 ||
        !Number.isInteger(level) || level < 1 || level > 0x7fffffff ||
        !Number.isInteger(gold) || gold < 0 || gold > 0x7fffffff) {
      throw new TypeError('registro de personagem não corresponde ao perfil Caracatoa.');
    }
    slots.add(slot);

    const nameOffset = offset + SEL_CHAR_NAME_OFFSET + slot * 16;
    Buffer.from(name, 'ascii').copy(body, nameOffset);
    body.writeInt32LE(level, offset + SEL_CHAR_SCORE_OFFSET + slot * 48);
    // The WYDBot character grid derives the class from Equip[0].Index / 10.
    body.writeUInt16LE(classId * 10, offset + SEL_CHAR_EQUIP_OFFSET + slot * SEL_CHAR_EQUIP_SIZE);
    body.writeInt32LE(gold, offset + SEL_CHAR_COIN_OFFSET + slot * 4);
  }
}

/** Blank but structurally complete login state until a character store is connected. */
export function buildWyd727LoginSuccessfulBody({
  clientId,
  timestamp = Date.now() >>> 0,
  hashKeyTable,
}) {
  if (!Number.isInteger(clientId) || clientId < 1 || clientId > 0xffff) {
    throw new RangeError('clientId precisa ficar entre 1 e 65535.');
  }
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff) {
    throw new RangeError('timestamp precisa caber em UInt32.');
  }
  if (!(Buffer.isBuffer(hashKeyTable) || hashKeyTable instanceof Uint8Array) || hashKeyTable.length !== 16 || hashKeyTable[0] === 0) {
    throw new TypeError('hashKeyTable precisa ter 16 bytes e começar com valor não zero.');
  }

  const body = Buffer.alloc(2808 - 4);
  body.writeUInt16LE(0x10a, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  Buffer.from(hashKeyTable).copy(body, 8);
  return body;
}

/** A client-compatible 0x105 popup; code 0x7FFF intentionally uses the client's numeric fallback. */
export function buildWyd727LoginDeniedBody() {
  const body = Buffer.alloc(16 - 4);
  body.writeUInt16LE(0x105, 0);
  body.writeUInt8(0, 8); // popup subtype recognized by the WYDBot login bridge
  body.writeUInt8(0, 9); // reserved
  body.writeInt16LE(CARACATOA_LOGIN_DENIED_CODE, 10);
  return body;
}

/** Token results are dispatched by opcode. The public client requires only the 12-byte frame header. */
export function buildWyd727TokenResultBody(accepted) {
  const body = Buffer.alloc(12 - 4);
  body.writeUInt16LE(accepted ? 0xfde : 0xfdf, 0);
  return body;
}

/** Caracatoa-only create result: 16-byte frame including the four-byte frame header. */
export function buildCaracatoaCharacterCreateResultBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status,
  slot,
  classId,
}) {
  if (!Number.isInteger(clientId) || clientId < 0 || clientId > 0xffff) {
    throw new RangeError('clientId precisa caber em UInt16.');
  }
  if (!Number.isInteger(status) || status < 0 || status > 7 ||
      !Number.isInteger(slot) || slot < 0 || slot > 0xff ||
      !Number.isInteger(classId) || classId < 0 || classId > 0xff) {
    throw new RangeError('resultado de criação Caracatoa inválido.');
  }
  const body = Buffer.alloc(16 - 4);
  body.writeUInt16LE(0x7f01, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(1, 8);
  body.writeUInt8(status, 9);
  body.writeUInt8(slot, 10);
  body.writeUInt8(classId, 11);
  return body;
}

/** WYDBot's 0x110 ResendCharList packet (1224 bytes including frame header). */
export function buildWyd727CharacterListUpdateBody({
  clientId,
  timestamp = Date.now() >>> 0,
  characters = [],
}) {
  if (!Number.isInteger(clientId) || clientId < 0 || clientId > 0xffff) {
    throw new RangeError('clientId precisa caber em UInt16.');
  }
  const body = Buffer.alloc(1224 - 4);
  body.writeUInt16LE(0x110, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  writeCharacterRoster(body, 12, characters);
  return body;
}
