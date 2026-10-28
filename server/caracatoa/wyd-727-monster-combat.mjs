/**
 * Caracatoa-owned combat rules using the public WYD 7.27 packet field layout
 * from wydbot2/wydbot at commit 0679d0b5f81ac08bb088b2d9fe5b4f3da779531d.
 * The fork is MIT-licensed; its license and notices remain with the client.
 */

import {
  computeCaracatoaCounterattackDamage,
  computeCaracatoaDamage,
} from "./caracatoa-combat.mjs";

const BASIC_ATTACK_BODY_LENGTH = 68;
const MONSTER_DEATH_BODY_LENGTH = 28;
const PLAYER_HP_MP_SYNC_BODY_LENGTH = 16;
export const CARACATOA_BASIC_ATTACK_COOLDOWN_MS = 1000;
export const CARACATOA_MONSTER_EXPERIENCE_PER_LEVEL = 10;

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

function hasOnlyZeros(buffer, start, end) {
  for (let offset = start; offset < end; offset += 1) {
    if (buffer[offset] !== 0) return false;
  }
  return true;
}

/** Parse only the public WYDBot 7.27 no-skill, single-target 0x39D builder shape. */
export function parseWyd727BasicAttackRequest(body) {
  if (!Buffer.isBuffer(body) || body.length !== BASIC_ATTACK_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== 0x39d) {
    return { malformed: true, reason: "invalid-opcode" };
  }

  const clientId = body.readUInt16LE(2);
  const sourceMobIndex = body.readUInt16LE(38);
  const targetMobIndex = body.readUInt16LE(56);
  if (
    clientId === 0 ||
    sourceMobIndex !== clientId ||
    targetMobIndex === 0 ||
    body.readUInt16LE(40) !== 0 ||
    body[42] !== 4 ||
    !hasOnlyZeros(body, 43, 45) ||
    body[45] !== 0 ||
    !hasOnlyZeros(body, 46, 48) ||
    body.readInt32LE(48) !== 0 ||
    body.readInt16LE(52) !== -1 ||
    !hasOnlyZeros(body, 54, 56) ||
    !hasOnlyZeros(body, 58, 60) ||
    body.readInt32LE(60) !== -2 ||
    !hasOnlyZeros(body, 64, 68)
  ) {
    return { malformed: true, reason: "unsupported-basic-attack-shape" };
  }

  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    sourcePosition: { x: body.readUInt16LE(30), y: body.readUInt16LE(32) },
    targetPosition: { x: body.readUInt16LE(34), y: body.readUInt16LE(36) },
    sourceMobIndex,
    targetMobIndex,
  };
}

/** Parse the public WYDBot 7.27 0x39D single-target skill-cast builder shape. */
export function parseWyd727SingleTargetSkillAttackRequest(body) {
  if (!Buffer.isBuffer(body) || body.length !== BASIC_ATTACK_BODY_LENGTH) {
    return { malformed: true, reason: "invalid-length" };
  }
  if (body.readUInt16LE(0) !== 0x39d) {
    return { malformed: true, reason: "invalid-opcode" };
  }

  const clientId = body.readUInt16LE(2);
  const sourceMobIndex = body.readUInt16LE(38);
  const skillId = body.readUInt16LE(52);
  const targetMobIndex = body.readUInt16LE(56);
  if (
    clientId === 0 ||
    sourceMobIndex !== clientId ||
    targetMobIndex === 0 ||
    skillId < 1 ||
    skillId > 95 ||
    body.readUInt16LE(40) !== 0 ||
    body[42] !== 0xff ||
    !hasOnlyZeros(body, 43, 48) ||
    body.readInt32LE(48) !== -1 ||
    !hasOnlyZeros(body, 54, 56) ||
    !hasOnlyZeros(body, 58, 60) ||
    body.readInt32LE(60) !== -1 ||
    !hasOnlyZeros(body, 64, 68)
  ) {
    return { malformed: true, reason: "unsupported-single-target-skill-shape" };
  }

  return {
    malformed: false,
    clientId,
    timestamp: body.readUInt32LE(4),
    sourcePosition: { x: body.readUInt16LE(30), y: body.readUInt16LE(32) },
    targetPosition: { x: body.readUInt16LE(34), y: body.readUInt16LE(36) },
    sourceMobIndex,
    targetMobIndex,
    skillId,
  };
}

export function readWyd727MonsterCombatState(body) {
  if (
    !Buffer.isBuffer(body) ||
    body.length !== 252 ||
    body.readUInt16LE(0) !== 0x364
  ) {
    throw new TypeError("Pacote 0x364 de monstro inválido.");
  }
  const monster = {
    clientEntityId: body.readUInt16LE(12),
    position: { x: body.readInt16LE(8), y: body.readInt16LE(10) },
    level: body.readInt32LE(136),
    defense: body.readInt32LE(140),
    damage: body.readInt32LE(144),
    movementSpeed: body.readUInt8(149),
    maxHp: body.readInt32LE(152),
    currentHp: body.readInt32LE(160),
  };
  if (
    monster.clientEntityId === 0 ||
    monster.level < 1 ||
    monster.defense < 0 ||
    monster.damage < 0 ||
    monster.movementSpeed < 1 ||
    monster.movementSpeed > 7 ||
    monster.maxHp < 1 ||
    monster.currentHp < 0 ||
    monster.currentHp > monster.maxHp
  ) {
    throw new RangeError("Stats de combate do monstro fora do intervalo.");
  }
  return monster;
}

export function isWyd727BasicAttackInRange(source, target) {
  if (
    !source ||
    !target ||
    !Number.isInteger(source.x) ||
    !Number.isInteger(source.y) ||
    !Number.isInteger(target.x) ||
    !Number.isInteger(target.y)
  ) {
    return false;
  }
  const distance = Math.max(
    Math.abs(source.x - target.x),
    Math.abs(source.y - target.y),
  );
  return distance === 1;
}

/** Chebyshev tile range used by catalogued Caracatoa single-target skills. */
export function isCaracatoaSkillTargetInRange(source, target, rangeTiles) {
  if (
    !source || !target ||
    !Number.isInteger(source.x) || !Number.isInteger(source.y) ||
    !Number.isInteger(target.x) || !Number.isInteger(target.y) ||
    !Number.isInteger(rangeTiles) || rangeTiles < 1 || rangeTiles > 12
  ) return false;
  const distance = Math.max(Math.abs(source.x - target.x), Math.abs(source.y - target.y));
  return distance >= 1 && distance <= rangeTiles;
}

export function computeCaracatoaBasicAttackDamage(
  playerDamage,
  monsterDefense,
) {
  return computeCaracatoaDamage({
    attackPower: playerDamage,
    defense: monsterDefense,
  });
}

export function computeCaracatoaMonsterExperienceReward(monsterLevel) {
  assertInteger(monsterLevel, 1, 0x7fffffff, "monsterLevel");
  return monsterLevel * CARACATOA_MONSTER_EXPERIENCE_PER_LEVEL;
}

/** Caracatoa melee retaliation: monster damage reduced by player defense. */
export function computeCaracatoaMonsterCounterattackDamage(
  monsterDamage,
  playerDefense,
) {
  return computeCaracatoaCounterattackDamage(monsterDamage, playerDefense);
}

/** Build the 68-byte packet body consumed by WYDBot's inbound 0x39D parser. */
export function buildWyd727BasicAttackResultBody({
  clientId,
  timestamp,
  targetMobIndex,
  damage,
  skillCode = 0,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(targetMobIndex, 1, 0xffff, "targetMobIndex");
  assertInteger(damage, 1, 0x7fffffff, "damage");
  assertInteger(skillCode, 0, 0xffff, "skillCode");
  const body = Buffer.alloc(BASIC_ATTACK_BODY_LENGTH);
  body.writeUInt16LE(0x39d, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt16LE(skillCode, 52); // inbound skillCode
  body.writeUInt16LE(targetMobIndex, 56);
  body.writeInt32LE(damage, 60);
  return body;
}

/** Build the 28-byte packet body consumed by WYDBot's inbound 0x338 parser. */
export function buildWyd727MonsterDeathBody({
  clientId,
  timestamp,
  killed,
  killer,
  experienceGained = 0,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(killed, 1, 0xffff, "killed");
  assertInteger(killer, 0, 0xffff, "killer");
  assertInteger(
    experienceGained,
    0,
    Number.MAX_SAFE_INTEGER,
    "experienceGained",
  );
  const body = Buffer.alloc(MONSTER_DEATH_BODY_LENGTH);
  body.writeUInt16LE(0x338, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt16LE(killed, 12);
  body.writeUInt16LE(killer, 14);
  body.writeBigInt64LE(BigInt(experienceGained), 20);
  return body;
}

/** `0x36A` subtype 2 is the WYDBot public state-delta path that clears isDead. */
export function buildWyd727MonsterRespawnStateBody({ entityId, timestamp }) {
  assertInteger(entityId, 1, 0xffff, "entityId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  const body = Buffer.alloc(16);
  body.writeUInt16LE(0x36a, 0);
  body.writeUInt16LE(entityId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt16LE(0, 8); // action code
  body.writeInt16LE(2, 10); // state subtype 2 clears entity isDead
  return body;
}

/** Build the 16-byte body for WYDBot's 20-byte framed 0x181 HP/MP sync. */
export function buildWyd727PlayerHpMpSyncBody({
  clientId,
  timestamp,
  currentHp,
  currentMp,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(currentHp, 0, 0x7fffffff, "currentHp");
  assertInteger(currentMp, 0, 0x7fffffff, "currentMp");
  const body = Buffer.alloc(PLAYER_HP_MP_SYNC_BODY_LENGTH);
  body.writeUInt16LE(0x181, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeInt32LE(currentHp, 8);
  body.writeInt32LE(currentMp, 12);
  return body;
}
