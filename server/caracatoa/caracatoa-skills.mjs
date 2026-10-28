export const CARACATOA_SKILL_LEARN_REQUEST_OPCODE = 0x7f05;
export const CARACATOA_SKILL_STATE_OPCODE = 0x7f06;
export const CARACATOA_SKILL_EFFECT_RESULT_OPCODE = 0x7f09;
export const CARACATOA_SKILL_PROTOCOL_VERSION = 1;
export const CARACATOA_SKILL_REQUEST_BYTES = 12;
export const CARACATOA_SKILL_STATE_BYTES = 32;
export const CARACATOA_SKILL_EFFECT_RESULT_BYTES = 32;
export const CARACATOA_SKILL_EFFECT_TYPE = Object.freeze({ heal: 1, defense: 2 });
export const CARACATOA_MAX_CLIENT_SKILL_ID = 95;

export const CARACATOA_SKILL_SYNC_STATUS = Object.freeze({
  snapshot: 0,
  learned: 1,
  alreadyLearned: 2,
  insufficientPoints: 3,
  levelLocked: 4,
  prerequisiteLocked: 5,
  wrongClass: 6,
  unknownSkill: 7,
});
export const CARACATOA_SKILL_EFFECT_STATUS = Object.freeze({
  applied: 0,
  fullHealth: 1,
  insufficientMana: 2,
  dead: 3,
});

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

export function parseCaracatoaSkillLearnRequest(body) {
  if (!Buffer.isBuffer(body) || body.length !== CARACATOA_SKILL_REQUEST_BYTES) {
    return { malformed: true, reason: "invalid-length" };
  }
  const clientId = body.readUInt16LE(2);
  const version = body.readUInt8(8);
  const clientSkillId = body.readUInt8(9);
  if (
    body.readUInt16LE(0) !== CARACATOA_SKILL_LEARN_REQUEST_OPCODE ||
    clientId === 0 ||
    version !== CARACATOA_SKILL_PROTOCOL_VERSION ||
    clientSkillId < 1 ||
    clientSkillId > CARACATOA_MAX_CLIENT_SKILL_ID ||
    body.readUInt16LE(10) !== 0
  ) {
    return { malformed: true, reason: "invalid-fields" };
  }
  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    clientSkillId,
  };
}

export function buildCaracatoaSkillStateBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status,
  clientSkillId = 0xff,
  availablePoints,
  learnedSkills,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(status, 0, 7, "status");
  assertInteger(clientSkillId, 1, 0xff, "clientSkillId");
  if (status === CARACATOA_SKILL_SYNC_STATUS.snapshot && clientSkillId !== 0xff) {
    throw new RangeError("Snapshot de habilidades deve usar clientSkillId 0xFF.");
  }
  if (status !== CARACATOA_SKILL_SYNC_STATUS.snapshot && clientSkillId === 0xff) {
    throw new RangeError("Resultado de aprendizado precisa identificar a habilidade.");
  }
  assertInteger(availablePoints, 0, 0xffffffff, "availablePoints");
  if (!Array.isArray(learnedSkills) || learnedSkills.length > 95) {
    throw new TypeError("learnedSkills precisa conter até 95 IDs.");
  }
  const learnedIds = new Set();
  for (const skill of learnedSkills) {
    const id = typeof skill === "number" ? skill : skill?.properties?.clientSkillId;
    assertInteger(id, 1, CARACATOA_MAX_CLIENT_SKILL_ID, "clientSkillId aprendido");
    if (learnedIds.has(id)) throw new Error(`Habilidade duplicada: ${id}.`);
    learnedIds.add(id);
  }

  const body = Buffer.alloc(CARACATOA_SKILL_STATE_BYTES);
  body.writeUInt16LE(CARACATOA_SKILL_STATE_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_SKILL_PROTOCOL_VERSION, 8);
  body.writeUInt8(status, 9);
  body.writeUInt8(clientSkillId, 10);
  body.writeUInt32LE(availablePoints, 12);
  for (const id of learnedIds) {
    const bit = id - 1;
    const byteOffset = 16 + Math.floor(bit / 8);
    body[byteOffset] |= 1 << (bit % 8);
  }
  return body;
}

export function buildCaracatoaSkillEffectResultBody({
  clientId,
  timestamp = Date.now() >>> 0,
  status,
  clientSkillId,
  effectType = CARACATOA_SKILL_EFFECT_TYPE.heal,
  amount = 0,
  durationMs = 0,
  currentHp,
  maxHp,
  currentMp,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(status, 0, 3, "status");
  assertInteger(clientSkillId, 1, CARACATOA_MAX_CLIENT_SKILL_ID, "clientSkillId");
  assertInteger(effectType, 1, 2, "effectType");
  assertInteger(amount, 0, 0x7fffffff, "amount");
  assertInteger(durationMs, 0, 120_000, "durationMs");
  assertInteger(currentHp, 0, 0x7fffffff, "currentHp");
  assertInteger(maxHp, 1, 0x7fffffff, "maxHp");
  assertInteger(currentMp, 0, 0x7fffffff, "currentMp");
  const applied = status === CARACATOA_SKILL_EFFECT_STATUS.applied;
  if (
    currentHp > maxHp ||
    (effectType === CARACATOA_SKILL_EFFECT_TYPE.heal && durationMs !== 0) ||
    (effectType === CARACATOA_SKILL_EFFECT_TYPE.defense && (applied ? durationMs < 1000 || amount < 1 : durationMs !== 0 || amount !== 0)) ||
    (applied ? amount < 1 : amount !== 0)
  ) {
    throw new RangeError("Resultado de efeito de habilidade inconsistente.");
  }

  const body = Buffer.alloc(CARACATOA_SKILL_EFFECT_RESULT_BYTES);
  body.writeUInt16LE(CARACATOA_SKILL_EFFECT_RESULT_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_SKILL_PROTOCOL_VERSION, 8);
  body.writeUInt8(status, 9);
  body.writeUInt8(clientSkillId, 10);
  body.writeUInt8(effectType, 11);
  body.writeInt32LE(amount, 12);
  body.writeInt32LE(currentHp, 16);
  body.writeInt32LE(maxHp, 20);
  body.writeInt32LE(currentMp, 24);
  body.writeUInt32LE(durationMs, 28);
  return body;
}
