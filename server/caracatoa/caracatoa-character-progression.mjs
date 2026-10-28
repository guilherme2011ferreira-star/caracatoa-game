export const CARACATOA_MAX_CHARACTER_LEVEL = 0x7fffffff;
export const CARACATOA_HP_PER_LEVEL = 10;
export const CARACATOA_MP_PER_LEVEL = 5;
export const CARACATOA_DAMAGE_PER_LEVEL = 1;
export const CARACATOA_ATTRIBUTE_POINTS_PER_LEVEL = 5;
export const CARACATOA_INITIAL_ATTRIBUTE_POINTS = 5;
export const CARACATOA_SKILL_POINTS_PER_LEVEL = 1;
export const CARACATOA_INITIAL_SKILL_POINTS = 1;
export const CARACATOA_PROGRESSION_VERSION = 1;
export const CARACATOA_PROGRESSION_OPCODE = 0x7f02;

const INT32_MAX = 0x7fffffff;
const MAX_SAFE_EXPERIENCE = Number.MAX_SAFE_INTEGER;

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} fora do intervalo aceito.`);
  }
}

/** Total EXP required to reach a 1-based level using the Caracatoa curve. */
export function getCaracatoaExperienceForLevel(level) {
  assertInteger(level, 1, CARACATOA_MAX_CHARACTER_LEVEL, "level");
  const target = BigInt(level);
  return Number(5n * target * (target - 1n));
}

/**
 * The next level costs 10 × current level EXP. Binary search keeps this
 * bounded even when an account already has a large valid Int64 experience.
 */
export function getCaracatoaLevelForExperience(
  experience,
  minimumLevel = 1,
) {
  assertInteger(experience, 0, MAX_SAFE_EXPERIENCE, "experience");
  assertInteger(minimumLevel, 1, CARACATOA_MAX_CHARACTER_LEVEL, "minimumLevel");
  const total = BigInt(experience);
  let low = 1n;
  let high = BigInt(CARACATOA_MAX_CHARACTER_LEVEL);
  while (low < high) {
    const middle = (low + high + 1n) >> 1n;
    const required = 5n * middle * (middle - 1n);
    if (required <= total) low = middle;
    else high = middle - 1n;
  }
  return Math.max(minimumLevel, Number(low));
}

/** Caracatoa stat growth. Current HP/MP stay unchanged in this projection. */
export function getCaracatoaStatsAtLevel(startingStats, level) {
  assertInteger(level, 1, CARACATOA_MAX_CHARACTER_LEVEL, "level");
  if (!startingStats || typeof startingStats !== "object") {
    throw new TypeError("startingStats precisa ser um objeto.");
  }
  const levelsGained = level - 1;
  const stats = {
    ...startingStats,
    maxHp: startingStats.maxHp + levelsGained * CARACATOA_HP_PER_LEVEL,
    maxMp: startingStats.maxMp + levelsGained * CARACATOA_MP_PER_LEVEL,
    damage:
      startingStats.damage + levelsGained * CARACATOA_DAMAGE_PER_LEVEL,
  };
  for (const field of ["maxHp", "maxMp", "damage"]) {
    if (!Number.isSafeInteger(stats[field]) || stats[field] > INT32_MAX) {
      throw new RangeError(`progression.${field} excedeu Int32.`);
    }
  }
  return stats;
}

/**
 * Apply the character's allocated Caracatoa attributes to level-derived stats.
 * STR adds physical damage, INT adds MP and spell damage, DEX adds defense,
 * and CON adds HP. The allocation values are points spent, not total scores.
 */
export function getCaracatoaStatsWithAttributes(
  startingStats,
  level,
  allocated = {},
) {
  const stats = getCaracatoaStatsAtLevel(startingStats, level);
  const points = {};
  for (const [field, allocationField] of [
    ["str", "str"],
    ["int", "int"],
    ["dex", "dex"],
    ["con", "con"],
  ]) {
    const value = allocated[allocationField] ?? 0;
    assertInteger(value, 0, 0xffff, `allocated.${allocationField}`);
    const total = startingStats[field] + value;
    assertInteger(total, 0, 0xffff, field);
    stats[field] = total;
    points[field] = value;
  }
  stats.damage += points.str;
  stats.defense += points.dex;
  stats.maxHp += points.con * 10;
  stats.maxMp += points.int * 5;
  for (const field of ["damage", "defense", "maxHp", "maxMp"]) {
    if (!Number.isSafeInteger(stats[field]) || stats[field] < 0 || stats[field] > INT32_MAX) {
      throw new RangeError(`attributes.${field} excedeu Int32.`);
    }
  }
  return stats;
}

/** Build the 44-byte WYD body for the private Caracatoa 0x7F02 snapshot. */
export function buildCaracatoaProgressionSyncBody({
  clientId,
  timestamp = Date.now() >>> 0,
  level,
  experience,
  currentHp,
  maxHp,
  currentMp,
  maxMp,
  damage,
}) {
  assertInteger(clientId, 1, 0xffff, "clientId");
  assertInteger(timestamp, 0, 0xffffffff, "timestamp");
  assertInteger(level, 1, CARACATOA_MAX_CHARACTER_LEVEL, "level");
  assertInteger(experience, 0, MAX_SAFE_EXPERIENCE, "experience");
  assertInteger(maxHp, 1, INT32_MAX, "maxHp");
  assertInteger(currentHp, 0, maxHp, "currentHp");
  assertInteger(maxMp, 0, INT32_MAX, "maxMp");
  assertInteger(currentMp, 0, maxMp, "currentMp");
  assertInteger(damage, 0, INT32_MAX, "damage");

  const body = Buffer.alloc(44);
  body.writeUInt16LE(CARACATOA_PROGRESSION_OPCODE, 0);
  body.writeUInt16LE(clientId, 2);
  body.writeUInt32LE(timestamp >>> 0, 4);
  body.writeUInt8(CARACATOA_PROGRESSION_VERSION, 8);
  // Bytes 9–11 are reserved and remain zero.
  body.writeUInt32LE(level, 12);
  body.writeBigInt64LE(BigInt(experience), 16);
  body.writeInt32LE(currentHp, 24);
  body.writeInt32LE(maxHp, 28);
  body.writeInt32LE(currentMp, 32);
  body.writeInt32LE(maxMp, 36);
  body.writeInt32LE(damage, 40);
  return body;
}
