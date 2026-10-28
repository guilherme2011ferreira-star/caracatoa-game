import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaracatoaSkillStateBody,
  buildCaracatoaSkillEffectResultBody,
  CARACATOA_SKILL_EFFECT_RESULT_OPCODE,
  CARACATOA_SKILL_EFFECT_STATUS,
  CARACATOA_SKILL_LEARN_REQUEST_OPCODE,
  CARACATOA_SKILL_STATE_OPCODE,
  CARACATOA_SKILL_SYNC_STATUS,
  parseCaracatoaSkillLearnRequest,
} from "./caracatoa-skills.mjs";

test("skill learn request fixture fixes header, fields, size, and reserved bytes", () => {
  const body = Buffer.alloc(12);
  body.writeUInt16LE(CARACATOA_SKILL_LEARN_REQUEST_OPCODE, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x01020304, 4);
  body.writeUInt8(1, 8);
  body.writeUInt8(25, 9);
  assert.deepEqual(parseCaracatoaSkillLearnRequest(body), {
    malformed: false,
    clientId: 0x1234,
    timestamp: 0x01020304,
    clientSkillId: 25,
  });
  assert.equal(body.readUInt16LE(0), 0x7f05);
  assert.equal(body.length, 12);
  body.writeUInt8(1, 11);
  assert.equal(parseCaracatoaSkillLearnRequest(body).malformed, true);
  assert.equal(parseCaracatoaSkillLearnRequest(Buffer.alloc(11)).malformed, true);
});

test("self-heal result fixture carries applied and rejected states in a fixed contract", () => {
  const applied = buildCaracatoaSkillEffectResultBody({
    clientId: 0x1234,
    timestamp: 0x01020304,
    status: CARACATOA_SKILL_EFFECT_STATUS.applied,
    clientSkillId: 27,
    amount: 31,
    effectType: 1,
    currentHp: 80,
    maxHp: 100,
    currentMp: 90,
  });
  assert.equal(applied.length, 32);
  assert.equal(applied.readUInt16LE(0), CARACATOA_SKILL_EFFECT_RESULT_OPCODE);
  assert.equal(applied.readUInt16LE(2), 0x1234);
  assert.equal(applied.readUInt32LE(4), 0x01020304);
  assert.equal(applied.readUInt8(8), 1);
  assert.equal(applied.readUInt8(9), 0);
  assert.equal(applied.readUInt8(10), 27);
  assert.equal(applied.readUInt8(11), 1);
  assert.equal(applied.readInt32LE(12), 31);
  assert.equal(applied.readInt32LE(16), 80);
  assert.equal(applied.readInt32LE(20), 100);
  assert.equal(applied.readInt32LE(24), 90);
  assert.equal(applied.readUInt32LE(28), 0);

  const defense = buildCaracatoaSkillEffectResultBody({
    clientId: 0x1234,
    status: CARACATOA_SKILL_EFFECT_STATUS.applied,
    clientSkillId: 3,
    effectType: 2,
    amount: 21,
    durationMs: 8000,
    currentHp: 80,
    maxHp: 100,
    currentMp: 88,
  });
  assert.equal(defense.readUInt8(11), 2);
  assert.equal(defense.readInt32LE(12), 21);
  assert.equal(defense.readUInt32LE(28), 8000);

  assert.throws(() => buildCaracatoaSkillEffectResultBody({
    clientId: 0x1234,
    status: CARACATOA_SKILL_EFFECT_STATUS.fullHealth,
    clientSkillId: 27,
    amount: 1,
    currentHp: 100,
    maxHp: 100,
    currentMp: 90,
  }));
});

test("skill state snapshot fixture carries durable points and learned bitset", () => {
  const body = buildCaracatoaSkillStateBody({
    clientId: 0x1234,
    timestamp: 0x01020304,
    status: CARACATOA_SKILL_SYNC_STATUS.snapshot,
    clientSkillId: 0xff,
    availablePoints: 1,
    learnedSkills: [],
  });
  assert.equal(body.length, 32);
  assert.equal(body.readUInt16LE(0), CARACATOA_SKILL_STATE_OPCODE);
  assert.equal(body.readUInt16LE(2), 0x1234);
  assert.equal(body.readUInt32LE(4), 0x01020304);
  assert.equal(body.readUInt8(8), 1);
  assert.equal(body.readUInt8(9), 0);
  assert.equal(body.readUInt8(10), 0xff);
  assert.equal(body.readUInt32LE(12), 1);
  assert.equal(body.readUInt8(16 + Math.floor((25 - 1) / 8)), 0);

  const learned = buildCaracatoaSkillStateBody({
    clientId: 0x1234,
    status: CARACATOA_SKILL_SYNC_STATUS.learned,
    clientSkillId: 25,
    availablePoints: 0,
    learnedSkills: [25],
  });
  assert.equal(learned.readUInt8(16 + Math.floor((25 - 1) / 8)) & 1, 1);
});
