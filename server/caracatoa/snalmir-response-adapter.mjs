import { randomBytes } from 'node:crypto';
import { decodeFrame } from './protocol.mjs';

// These are two independently published wire layouts. The adapter maps fields
// explicitly; it does not share or copy Snalmir implementation code.
const SNALMIR_CHAR_LIST_FRAME_SIZE = 1824;
const SNALMIR_CHAR_LIST_BODY_SIZE = SNALMIR_CHAR_LIST_FRAME_SIZE - 4;
const SNALMIR_CHAR_LIST_BODY_OFFSET = 8;
const SNALMIR_CHAR_LIST_SIZE = 744;
const SNALMIR_STATUS_OFFSET = 80;
const SNALMIR_STATUS_SIZE = 28;
const SNALMIR_EQUIP_OFFSET = 192;
const SNALMIR_EQUIP_SLOT_SIZE = 128;
const SNALMIR_ITEM_SIZE = 8;
const SNALMIR_STORAGE_OFFSET = 752;
const SNALMIR_GOLD_OFFSET = 1776;
const SNALMIR_ACCOUNT_NAME_OFFSET = 1780;
const SNALMIR_KEYS_OFFSET = 1796;
const SNALMIR_ENTER_WORLD_FRAME_SIZE = 1244;
const SNALMIR_ENTER_WORLD_BODY_SIZE = SNALMIR_ENTER_WORLD_FRAME_SIZE - 4;
const SNALMIR_ENTER_WORLD_MOB_OFFSET = 12;
const SNALMIR_MOB_STATUS_OFFSET = 36;
const SNALMIR_MOB_CURRENT_STATUS_OFFSET = 64;
const SNALMIR_MOB_EQUIP_OFFSET = 92;
const SNALMIR_MOB_INVENTORY_OFFSET = 220;
const SNALMIR_MOB_LEARN_OFFSET = 732;
const SNALMIR_MOB_STATUS_POINTS_OFFSET = 736;
const SNALMIR_MOB_SKILL_POINTS_OFFSET = 738;
const SNALMIR_MOB_CRITICAL_OFFSET = 742;
const SNALMIR_MOB_SAVE_MANA_OFFSET = 743;
const SNALMIR_MOB_SKILL_BAR_1_OFFSET = 744;
const SNALMIR_MOB_RESIST_OFFSET = 752;
const SNALMIR_MOB_ATTACK_SPEED_OFFSET = 820;
const SNALMIR_MOB_SKILL_BAR_2_OFFSET = 764;
const SNALMIR_MOB_AFFECT_OFFSET = 1044;
const SNALMIR_MOB_AFFECT_COUNT = 16;

const WYD_LOGIN_BODY_SIZE = 2804;
const WYD_ROSTER_BODY_SIZE = 1220;
const WYD_SELECTION_SIZE = 1208;
const WYD_SELECTION_LOGIN_OFFSET = 28;
const WYD_SELECTION_ROSTER_OFFSET = 12;
const WYD_SCORE_OFFSET = 80;
const WYD_SCORE_SIZE = 48;
const WYD_EQUIP_OFFSET = 272;
const WYD_EQUIP_SLOT_SIZE = 216;
const WYD_ITEM_SIZE = 12;
const WYD_TRANSFORM_OFFSET = 1136;
const WYD_GUILD_OFFSET = 1144;
const WYD_COINS_OFFSET = 1160;
const WYD_EXPERIENCE_OFFSET = 1176;
const WYD_CARGO_OFFSET = 1236;
const WYD_CARGO_COIN_OFFSET = 2772;
const WYD_ACCOUNT_NAME_OFFSET = 2776;
const WYD_ACCOUNT_KEYS_OFFSET = 2792;

const WYD_ENTER_WORLD_BODY_SIZE = 2100;
const WYD_WORLD_POSITION_OFFSET = 8;
const WYD_WORLD_NAME_OFFSET = 12;
const WYD_WORLD_GUILD_OFFSET = 30;
const WYD_WORLD_CLASS_OFFSET = 32;
const WYD_WORLD_GOLD_OFFSET = 36;
const WYD_WORLD_EXPERIENCE_OFFSET = 44;
const WYD_WORLD_POSITION_XY_OFFSET = 52;
const WYD_WORLD_BASE_SCORE_OFFSET = 56;
const WYD_WORLD_FINAL_SCORE_OFFSET = 104;
const WYD_WORLD_EQUIP_OFFSET = 152;
const WYD_WORLD_INVENTORY_OFFSET = 368;
const WYD_WORLD_LEARN_0_OFFSET = 1136;
const WYD_WORLD_STATUS_POINTS_OFFSET = 1144;
const WYD_WORLD_SKILL_POINTS_OFFSET = 1148;
const WYD_WORLD_CRITICAL_OFFSET = 1150;
const WYD_WORLD_SAVE_MANA_OFFSET = 1151;
const WYD_WORLD_SKILL_BAR_0_OFFSET = 1152;
const WYD_WORLD_ATTACK_SPEED_OFFSET = 1158;
const WYD_WORLD_RESIST_OFFSET = 1366;
const WYD_WORLD_MOB_INDEX_OFFSET = 1382;
const WYD_WORLD_SKILL_BAR_1_OFFSET = 1386;
const WYD_WORLD_AFFECT_OFFSET = 1692;
const WYD_WORLD_SERVER_TIME_OFFSET = 2072;

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} precisa ser Buffer ou Uint8Array.`);
}

function requireUInt(value, maximum, label) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

// Seeds the client's per-connection request sequence; it is not an auth secret.
export function createCaracatoaSequenceHashTable(randomSource = randomBytes) {
  if (typeof randomSource !== 'function') {
    throw new TypeError('randomSource precisa ser uma função.');
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = asBuffer(randomSource(16), 'hashKeyTable');
    if (candidate.length !== 16) {
      throw new RangeError('randomSource precisa retornar exatamente 16 bytes.');
    }
    if (candidate[0] !== 0) return Buffer.from(candidate);
  }

  throw new Error('Não foi possível gerar uma tabela de sequência Caracatoa válida.');
}

function sourceNameIsPresent(source, sourceBase, slot) {
  const offset = sourceBase + 16 + (slot * 16);
  return source.subarray(offset, offset + 16).some((byte) => byte !== 0);
}

function convertScore(source, sourceOffset, target, targetOffset) {
  const packedMerchantDirection = source.readUInt8(sourceOffset + 6);
  const packedSpeedChaos = source.readUInt8(sourceOffset + 7);

  target.writeInt32LE(source.readUInt16LE(sourceOffset), targetOffset);
  target.writeInt32LE(source.readInt16LE(sourceOffset + 2), targetOffset + 4);
  target.writeInt32LE(source.readInt16LE(sourceOffset + 4), targetOffset + 8);
  target.writeUInt8(packedMerchantDirection & 0x0f, targetOffset + 12);
  target.writeUInt8(packedSpeedChaos & 0x0f, targetOffset + 13);
  target.writeUInt8((packedMerchantDirection >>> 4) & 0x0f, targetOffset + 14);
  target.writeUInt8((packedSpeedChaos >>> 4) & 0x0f, targetOffset + 15);

  for (const [sourceField, targetField] of [
    [8, 16], [10, 20], [12, 24], [14, 28],
  ]) {
    target.writeUInt32LE(source.readUInt16LE(sourceOffset + sourceField), targetOffset + targetField);
  }
  for (const [sourceField, targetField] of [
    [16, 32], [18, 34], [20, 36], [22, 38],
  ]) {
    target.writeUInt16LE(source.readUInt16LE(sourceOffset + sourceField), targetOffset + targetField);
  }
  for (let index = 0; index < 4; index += 1) {
    target.writeUInt16LE(source.readUInt8(sourceOffset + 24 + index), targetOffset + 40 + (index * 2));
  }
}

function convertItem(source, sourceOffset, target, targetOffset) {
  const itemId = source.readInt16LE(sourceOffset);
  if (itemId < 0) throw new RangeError('ID de item Snalmir negativo não é suportado.');

  target.writeUInt16LE(itemId, targetOffset);
  // Snalmir's item record has no stack-count or field04. One unit is the
  // narrowest representable value; effects and IDs remain explicit.
  target.writeInt16LE(itemId === 0 ? 0 : 1, targetOffset + 2);
  target.writeUInt16LE(0, targetOffset + 4);
  source.copy(target, targetOffset + 6, sourceOffset + 2, sourceOffset + SNALMIR_ITEM_SIZE);
}

function convertSelection(source, target, sourceBase, targetBase) {
  source.copy(target, targetBase, sourceBase, sourceBase + 16);
  source.copy(target, targetBase + 16, sourceBase + 16, sourceBase + 80);

  for (let slot = 0; slot < 4; slot += 1) {
    const sourceStatus = sourceBase + SNALMIR_STATUS_OFFSET + (slot * SNALMIR_STATUS_SIZE);
    const targetScore = targetBase + WYD_SCORE_OFFSET + (slot * WYD_SCORE_SIZE);
    convertScore(source, sourceStatus, target, targetScore);

    const sourceEquip = sourceBase + SNALMIR_EQUIP_OFFSET + (slot * SNALMIR_EQUIP_SLOT_SIZE);
    const targetEquip = targetBase + WYD_EQUIP_OFFSET + (slot * WYD_EQUIP_SLOT_SIZE);
    for (let item = 0; item < 16; item += 1) {
      convertItem(
        source,
        sourceEquip + (item * SNALMIR_ITEM_SIZE),
        target,
        targetEquip + (item * WYD_ITEM_SIZE),
      );
    }

    if (sourceNameIsPresent(source, sourceBase, slot)) {
      const bodyId = source.readUInt16LE(sourceEquip);
      if (Math.floor(bodyId / 10) > 3) {
        throw new RangeError('Classe no slot de corpo não pertence ao perfil Caracatoa.');
      }
    }

    // Snalmir's character-list struct has no separate transform ID.
    target.writeUInt16LE(0, targetBase + WYD_TRANSFORM_OFFSET + (slot * 2));
    target.writeInt32LE(
      source.readUInt16LE(sourceBase + 704 + (slot * 2)),
      targetBase + WYD_GUILD_OFFSET + (slot * 4),
    );
    target.writeInt32LE(
      source.readInt32LE(sourceBase + 712 + (slot * 4)),
      targetBase + WYD_COINS_OFFSET + (slot * 4),
    );
    target.writeBigInt64LE(
      BigInt(source.readUInt32LE(sourceBase + 728 + (slot * 4))),
      targetBase + WYD_EXPERIENCE_OFFSET + (slot * 8),
    );
  }
}

function buildHeader(body, opcode, clientId, timestamp) {
  body.writeUInt16LE(opcode, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
}

function convertWorldItems(source, target, sourceOffset, targetOffset, count) {
  for (let item = 0; item < count; item += 1) {
    convertItem(
      source,
      sourceOffset + (item * SNALMIR_ITEM_SIZE),
      target,
      targetOffset + (item * WYD_ITEM_SIZE),
    );
  }
}

/**
 * Convert Snalmir's public 0x114 packet into the Caracatoa client world-entry
 * body. Only fields with a source/target layout match are translated; all
 * unsupported target fields stay zero in the allocated output.
 */
export function adaptSnalmirEnterWorldFrame(input, options = {}) {
  const wire = asBuffer(input, 'frame 0x114 Snalmir');
  const decoded = decodeFrame(wire);
  if (!decoded.ok) throw new RangeError('Frame 0x114 Snalmir inválido.');
  if (wire.length !== SNALMIR_ENTER_WORLD_FRAME_SIZE ||
      decoded.frame.body.length !== SNALMIR_ENTER_WORLD_BODY_SIZE) {
    throw new RangeError('Comprimento de entrada no mundo Snalmir inesperado.');
  }

  const source = decoded.frame.body;
  if (source.readUInt16LE(0) !== 0x114) {
    throw new RangeError('Opcode de entrada no mundo Snalmir não suportado.');
  }

  requireUInt(options.clientId, 0xffff, 'clientId Caracatoa');
  requireUInt(options.timestamp, 0xffffffff, 'timestamp Caracatoa');
  requireUInt(options.mobIndex, 0xffff, 'mobIndex Caracatoa');
  if (options.mobIndex === 0) {
    throw new RangeError('mobIndex Caracatoa precisa ser diferente de zero.');
  }
  const serverTime = options.serverTime ?? 0;
  requireUInt(serverTime, 0xffffffff, 'serverTime Caracatoa');

  const sourceMob = SNALMIR_ENTER_WORLD_MOB_OFFSET;
  const sourceName = sourceMob;
  const sourceClass = sourceMob + 20;
  const classId = source.readUInt8(sourceClass);
  if (classId > 3) {
    throw new RangeError('Classe Snalmir não pertence ao perfil Caracatoa.');
  }

  const target = Buffer.alloc(WYD_ENTER_WORLD_BODY_SIZE);
  buildHeader(target, 0x114, options.clientId, options.timestamp);
  source.copy(target, WYD_WORLD_POSITION_OFFSET, 8, 12);
  source.copy(target, WYD_WORLD_POSITION_XY_OFFSET, 8, 12);
  source.copy(target, WYD_WORLD_NAME_OFFSET, sourceName, sourceName + 16);
  target.writeUInt16LE(source.readUInt16LE(sourceMob + 18), WYD_WORLD_GUILD_OFFSET);
  target.writeUInt8(classId, WYD_WORLD_CLASS_OFFSET);
  target.writeInt32LE(source.readInt32LE(sourceMob + 24), WYD_WORLD_GOLD_OFFSET);
  target.writeBigInt64LE(BigInt(source.readUInt32LE(sourceMob + 28)), WYD_WORLD_EXPERIENCE_OFFSET);

  convertScore(
    source,
    sourceMob + SNALMIR_MOB_STATUS_OFFSET,
    target,
    WYD_WORLD_BASE_SCORE_OFFSET,
  );
  convertScore(
    source,
    sourceMob + SNALMIR_MOB_CURRENT_STATUS_OFFSET,
    target,
    WYD_WORLD_FINAL_SCORE_OFFSET,
  );
  convertWorldItems(
    source,
    target,
    sourceMob + SNALMIR_MOB_EQUIP_OFFSET,
    WYD_WORLD_EQUIP_OFFSET,
    16,
  );
  convertWorldItems(
    source,
    target,
    sourceMob + SNALMIR_MOB_INVENTORY_OFFSET,
    WYD_WORLD_INVENTORY_OFFSET,
    60,
  );

  source.copy(target, WYD_WORLD_LEARN_0_OFFSET, sourceMob + SNALMIR_MOB_LEARN_OFFSET, sourceMob + SNALMIR_MOB_LEARN_OFFSET + 4);
  source.copy(target, WYD_WORLD_STATUS_POINTS_OFFSET, sourceMob + SNALMIR_MOB_STATUS_POINTS_OFFSET, sourceMob + SNALMIR_MOB_STATUS_POINTS_OFFSET + 2);
  source.copy(target, WYD_WORLD_SKILL_POINTS_OFFSET, sourceMob + SNALMIR_MOB_SKILL_POINTS_OFFSET, sourceMob + SNALMIR_MOB_SKILL_POINTS_OFFSET + 2);
  target.writeUInt8(source.readUInt8(sourceMob + SNALMIR_MOB_CRITICAL_OFFSET), WYD_WORLD_CRITICAL_OFFSET);
  target.writeUInt8(source.readUInt8(sourceMob + SNALMIR_MOB_SAVE_MANA_OFFSET), WYD_WORLD_SAVE_MANA_OFFSET);
  source.copy(target, WYD_WORLD_SKILL_BAR_0_OFFSET, sourceMob + SNALMIR_MOB_SKILL_BAR_1_OFFSET, sourceMob + SNALMIR_MOB_SKILL_BAR_1_OFFSET + 4);
  target.writeUInt16LE(source.readUInt16LE(sourceMob + SNALMIR_MOB_ATTACK_SPEED_OFFSET), WYD_WORLD_ATTACK_SPEED_OFFSET);
  for (let resist = 0; resist < 4; resist += 1) {
    target.writeUInt16LE(
      source.readUInt8(sourceMob + SNALMIR_MOB_RESIST_OFFSET + resist),
      WYD_WORLD_RESIST_OFFSET + (resist * 2),
    );
  }
  target.writeUInt16LE(options.mobIndex, WYD_WORLD_MOB_INDEX_OFFSET);
  source.copy(target, WYD_WORLD_SKILL_BAR_1_OFFSET, sourceMob + SNALMIR_MOB_SKILL_BAR_2_OFFSET, sourceMob + SNALMIR_MOB_SKILL_BAR_2_OFFSET + 16);
  source.copy(
    target,
    WYD_WORLD_AFFECT_OFFSET,
    sourceMob + SNALMIR_MOB_AFFECT_OFFSET,
    sourceMob + SNALMIR_MOB_AFFECT_OFFSET + (SNALMIR_MOB_AFFECT_COUNT * 8),
  );
  target.writeUInt32LE(serverTime, WYD_WORLD_SERVER_TIME_OFFSET);

  return { kind: 'world-entry', worldBody: target };
}

function parseCharacterListFrame(input, options) {
  const wire = asBuffer(input, 'frame Snalmir');
  const decoded = decodeFrame(wire);
  if (!decoded.ok) throw new RangeError('Frame Snalmir inválido.');
  if (wire.length !== SNALMIR_CHAR_LIST_FRAME_SIZE ||
      decoded.frame.body.length !== SNALMIR_CHAR_LIST_BODY_SIZE) {
    throw new RangeError('Comprimento de packet_char_list Snalmir inesperado.');
  }

  const source = decoded.frame.body;
  const opcode = source.readUInt16LE(0);
  if (opcode !== 0x10e && opcode !== 0x110) {
    throw new RangeError('Opcode de lista Snalmir não suportado.');
  }
  if (source.length < SNALMIR_CHAR_LIST_BODY_OFFSET + SNALMIR_CHAR_LIST_SIZE) {
    throw new RangeError('Lista de personagens Snalmir incompleta.');
  }

  requireUInt(options?.clientId, 0xffff, 'clientId Caracatoa');
  requireUInt(options?.timestamp, 0xffffffff, 'timestamp Caracatoa');
  return { source, opcode, clientId: options.clientId, timestamp: options.timestamp };
}

function buildRosterBody(source, clientId, timestamp) {
  const body = Buffer.alloc(WYD_ROSTER_BODY_SIZE);
  buildHeader(body, 0x110, clientId, timestamp);
  convertSelection(
    source,
    body,
    SNALMIR_CHAR_LIST_BODY_OFFSET,
    WYD_SELECTION_ROSTER_OFFSET,
  );
  return body;
}

/**
 * Convert a decrypted Snalmir packet_char_list frame into Caracatoa response
 * bodies. For 0x10E, the roster is returned separately so a session handler can
 * send it after PIN acceptance, preserving the client-visible request order.
 * `hashKeyTable` is injected by the caller and is synthetic in these fixtures.
 */
export function adaptSnalmirCharacterListFrame(input, options = {}) {
  const { source, opcode, clientId, timestamp } = parseCharacterListFrame(input, options);
  const rosterBody = buildRosterBody(source, clientId, timestamp);

  if (opcode === 0x110) {
    return { kind: 'roster-update', rosterBody };
  }

  const hashKeyTable = options.hashKeyTable === undefined
    ? createCaracatoaSequenceHashTable()
    : asBuffer(options.hashKeyTable, 'hashKeyTable');
  if (hashKeyTable.length !== 16 || hashKeyTable[0] === 0) {
    throw new RangeError('hashKeyTable precisa ter 16 bytes e começar com valor não zero.');
  }

  const loginBody = Buffer.alloc(WYD_LOGIN_BODY_SIZE);
  buildHeader(loginBody, 0x10a, clientId, timestamp);
  hashKeyTable.copy(loginBody, 8);
  convertSelection(
    source,
    loginBody,
    SNALMIR_CHAR_LIST_BODY_OFFSET,
    WYD_SELECTION_LOGIN_OFFSET,
  );

  for (let item = 0; item < 128; item += 1) {
    convertItem(
      source,
      SNALMIR_STORAGE_OFFSET + (item * SNALMIR_ITEM_SIZE),
      loginBody,
      WYD_CARGO_OFFSET + (item * WYD_ITEM_SIZE),
    );
  }
  loginBody.writeInt32LE(source.readInt32LE(SNALMIR_GOLD_OFFSET), WYD_CARGO_COIN_OFFSET);
  source.copy(loginBody, WYD_ACCOUNT_NAME_OFFSET, SNALMIR_ACCOUNT_NAME_OFFSET, SNALMIR_ACCOUNT_NAME_OFFSET + 16);
  source.copy(loginBody, WYD_ACCOUNT_KEYS_OFFSET, SNALMIR_KEYS_OFFSET, SNALMIR_KEYS_OFFSET + 12);

  return { kind: 'login', loginBody, rosterAfterPinBody: rosterBody };
}

/**
 * Translate Snalmir's PIN result to the short Caracatoa response body. On
 * success Snalmir echoes the submitted PIN in its 32-byte packet; only the
 * opcode is carried forward, so the digits never enter the translated body.
 */
export function adaptSnalmirPinResultFrame(input, options = {}) {
  const wire = asBuffer(input, 'frame PIN Snalmir');
  const decoded = decodeFrame(wire);
  if (!decoded.ok) throw new RangeError('Frame PIN Snalmir inválido.');

  const source = decoded.frame.body;
  const opcode = source.readUInt16LE(0);
  const expectedWireLength = opcode === 0xfde ? 32 : opcode === 0xfdf ? 12 : 0;
  if (expectedWireLength === 0) {
    throw new RangeError('Opcode de resultado PIN Snalmir não suportado.');
  }
  if (wire.length !== expectedWireLength) {
    throw new RangeError('Comprimento de resultado PIN Snalmir inesperado.');
  }

  requireUInt(options.clientId, 0xffff, 'clientId Caracatoa');
  requireUInt(options.timestamp, 0xffffffff, 'timestamp Caracatoa');

  const pinResultBody = Buffer.alloc(8);
  buildHeader(pinResultBody, opcode, options.clientId, options.timestamp);
  return { kind: 'pin-result', pinResultBody };
}
