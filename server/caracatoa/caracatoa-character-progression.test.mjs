import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaracatoaProgressionSyncBody,
  getCaracatoaExperienceForLevel,
  getCaracatoaLevelForExperience,
  getCaracatoaStatsAtLevel,
  getCaracatoaStatsWithAttributes,
} from "./caracatoa-character-progression.mjs";

test("Caracatoa EXP curve promotes at cumulative 10 times each previous level", () => {
  assert.equal(getCaracatoaExperienceForLevel(1), 0);
  assert.equal(getCaracatoaExperienceForLevel(2), 10);
  assert.equal(getCaracatoaExperienceForLevel(3), 30);
  assert.equal(getCaracatoaLevelForExperience(0), 1);
  assert.equal(getCaracatoaLevelForExperience(9), 1);
  assert.equal(getCaracatoaLevelForExperience(10), 2);
  assert.equal(getCaracatoaLevelForExperience(29), 2);
  assert.equal(getCaracatoaLevelForExperience(30), 3);
  assert.equal(getCaracatoaLevelForExperience(10, 5), 5);
  assert.equal(getCaracatoaLevelForExperience(Number.MAX_SAFE_INTEGER), 42_443_372);
});

test("level growth increases max HP, max MP, and damage but preserves current pools", () => {
  const stats = getCaracatoaStatsAtLevel(
    { damage: 41, maxHp: 180, maxMp: 140, currentHp: 170, currentMp: 130 },
    4,
  );
  assert.deepEqual(stats, {
    damage: 44,
    maxHp: 210,
    maxMp: 155,
    currentHp: 170,
    currentMp: 130,
  });
});

test("allocated attributes change derived combat values while preserving current pools", () => {
  const stats = getCaracatoaStatsWithAttributes(
    {
      str: 10,
      int: 10,
      dex: 10,
      con: 10,
      damage: 10,
      defense: 0,
      maxHp: 100,
      maxMp: 100,
      currentHp: 80,
      currentMp: 60,
    },
    1,
    { str: 1, int: 1, dex: 1, con: 1 },
  );
  assert.equal(stats.str, 11);
  assert.equal(stats.int, 11);
  assert.equal(stats.dex, 11);
  assert.equal(stats.con, 11);
  assert.equal(stats.damage, 11);
  assert.equal(stats.defense, 1);
  assert.equal(stats.maxHp, 110);
  assert.equal(stats.maxMp, 105);
  assert.equal(stats.currentHp, 80);
  assert.equal(stats.currentMp, 60);
});

test("0x7F02 encodes an absolute progression snapshot and rejects invalid state", () => {
  const body = buildCaracatoaProgressionSyncBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    level: 3,
    experience: 30,
    currentHp: 160,
    maxHp: 200,
    currentMp: 90,
    maxMp: 120,
    damage: 43,
  });
  assert.equal(body.length, 44);
  assert.equal(body.readUInt16LE(0), 0x7f02);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x10203040);
  assert.equal(body.readUInt8(8), 1);
  assert.equal(body.readUInt32LE(12), 3);
  assert.equal(body.readBigInt64LE(16), 30n);
  assert.equal(body.readInt32LE(24), 160);
  assert.equal(body.readInt32LE(28), 200);
  assert.equal(body.readInt32LE(32), 90);
  assert.equal(body.readInt32LE(36), 120);
  assert.equal(body.readInt32LE(40), 43);
  assert.throws(
    () =>
      buildCaracatoaProgressionSyncBody({
        clientId: 1,
        level: 2,
        experience: 10,
        currentHp: 101,
        maxHp: 100,
        currentMp: 1,
        maxMp: 10,
        damage: 1,
      }),
    RangeError,
  );
});
