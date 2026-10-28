import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWyd727BasicAttackResultBody,
  buildWyd727MonsterDeathBody,
  buildWyd727MonsterRespawnStateBody,
  buildWyd727PlayerHpMpSyncBody,
  computeCaracatoaBasicAttackDamage,
  computeCaracatoaMonsterCounterattackDamage,
  computeCaracatoaMonsterExperienceReward,
  isCaracatoaSkillTargetInRange,
  isWyd727BasicAttackInRange,
  parseWyd727BasicAttackRequest,
  parseWyd727SingleTargetSkillAttackRequest,
  readWyd727MonsterCombatState,
} from "./wyd-727-monster-combat.mjs";
import { inspectWyd727ServerFrame } from "./wyd-727-profile.mjs";

test("Caracatoa skill range uses validated Chebyshev tile distance", () => {
  assert.equal(isCaracatoaSkillTargetInRange({ x: 10, y: 10 }, { x: 15, y: 14 }, 5), true);
  assert.equal(isCaracatoaSkillTargetInRange({ x: 10, y: 10 }, { x: 16, y: 10 }, 5), false);
  assert.equal(isCaracatoaSkillTargetInRange({ x: 10, y: 10 }, { x: 11, y: 11 }, 1), true);
  assert.equal(isCaracatoaSkillTargetInRange({ x: 10, y: 10 }, { x: 10, y: 10 }, 1), false);
  assert.equal(isCaracatoaSkillTargetInRange({ x: 10, y: 10 }, { x: 11, y: 10 }, 13), false);
});

function basicAttackFixture() {
  const body = Buffer.alloc(68);
  body.writeUInt16LE(0x39d, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeUInt16LE(10, 30);
  body.writeUInt16LE(20, 32);
  body.writeUInt16LE(11, 34);
  body.writeUInt16LE(21, 36);
  body.writeUInt16LE(0x1234, 38);
  body.writeUInt8(4, 42);
  body.writeInt16LE(-1, 52);
  body.writeUInt16LE(0xfff0, 56);
  body.writeInt32LE(-2, 60);
  return body;
}

function skillAttackFixture(skillId = 25) {
  const body = Buffer.alloc(68);
  body.writeUInt16LE(0x39d, 0);
  body.writeUInt16LE(0x1234, 2);
  body.writeUInt32LE(0x10203040, 4);
  body.writeUInt16LE(10, 30);
  body.writeUInt16LE(20, 32);
  body.writeUInt16LE(11, 34);
  body.writeUInt16LE(21, 36);
  body.writeUInt16LE(0x1234, 38);
  body.writeUInt8(0xff, 42);
  body.writeInt32LE(-1, 48);
  body.writeUInt16LE(skillId, 52);
  body.writeUInt16LE(0xfff0, 56);
  body.writeInt32LE(-1, 60);
  return body;
}

test("strict WYDBot basic attack fixture exposes attacker and target fields", () => {
  assert.deepEqual(parseWyd727BasicAttackRequest(basicAttackFixture()), {
    malformed: false,
    clientId: 0x1234,
    timestamp: 0x10203040,
    sourcePosition: { x: 10, y: 20 },
    targetPosition: { x: 11, y: 21 },
    sourceMobIndex: 0x1234,
    targetMobIndex: 0xfff0,
  });
});

test("basic attack parser rejects wrong length and unsupported skill variants", () => {
  assert.deepEqual(parseWyd727BasicAttackRequest(Buffer.alloc(67)), {
    malformed: true,
    reason: "invalid-length",
  });
  const skill = basicAttackFixture();
  skill.writeInt32LE(7, 48);
  assert.equal(
    parseWyd727BasicAttackRequest(skill).reason,
    "unsupported-basic-attack-shape",
  );
  const wrongSource = basicAttackFixture();
  wrongSource.writeUInt16LE(0x9999, 38);
  assert.equal(parseWyd727BasicAttackRequest(wrongSource).malformed, true);
});

test("strict 0x39D single-target skill parser matches WYDBot cast sentinels", () => {
  assert.deepEqual(
    parseWyd727SingleTargetSkillAttackRequest(skillAttackFixture()),
    {
      malformed: false,
      clientId: 0x1234,
      timestamp: 0x10203040,
      sourcePosition: { x: 10, y: 20 },
      targetPosition: { x: 11, y: 21 },
      sourceMobIndex: 0x1234,
      targetMobIndex: 0xfff0,
      skillId: 25,
    },
  );
  const wrongSentinel = skillAttackFixture();
  wrongSentinel.writeInt32LE(0, 48);
  assert.equal(
    parseWyd727SingleTargetSkillAttackRequest(wrongSentinel).malformed,
    true,
  );
  assert.equal(
    parseWyd727SingleTargetSkillAttackRequest(skillAttackFixture(96)).malformed,
    true,
  );
});

test("monster runtime stats are read from the public 0x364 MScore offsets", () => {
  const body = Buffer.alloc(252);
  body.writeUInt16LE(0x364, 0);
  body.writeInt16LE(321, 8);
  body.writeInt16LE(123, 10);
  body.writeUInt16LE(0xfff0, 12);
  body.writeInt32LE(4, 136);
  body.writeInt32LE(5, 140);
  body.writeInt32LE(18, 144);
  body.writeUInt8(3, 149);
  body.writeInt32LE(70, 152);
  body.writeInt32LE(70, 160);
  assert.deepEqual(readWyd727MonsterCombatState(body), {
    clientEntityId: 0xfff0,
    position: { x: 321, y: 123 },
    level: 4,
    defense: 5,
    damage: 18,
    movementSpeed: 3,
    maxHp: 70,
    currentHp: 70,
  });
});

test("Caracatoa basic attack rule uses adjacent tiles and damage minus defense", () => {
  assert.equal(
    isWyd727BasicAttackInRange({ x: 5, y: 5 }, { x: 6, y: 6 }),
    true,
  );
  assert.equal(
    isWyd727BasicAttackInRange({ x: 5, y: 5 }, { x: 7, y: 5 }),
    false,
  );
  assert.equal(
    isWyd727BasicAttackInRange({ x: 5, y: 5 }, { x: 5, y: 5 }),
    false,
  );
  assert.equal(computeCaracatoaBasicAttackDamage(41, 5), 36);
  assert.equal(computeCaracatoaBasicAttackDamage(4, 5), 1);
  assert.equal(computeCaracatoaMonsterCounterattackDamage(18, 0), 18);
  assert.equal(computeCaracatoaMonsterCounterattackDamage(5, 7), 0);
  assert.equal(computeCaracatoaMonsterCounterattackDamage(0, 0), 0);
  assert.equal(computeCaracatoaMonsterExperienceReward(4), 40);
  assert.throws(() => computeCaracatoaMonsterExperienceReward(0), RangeError);
});

test("attack and death response builders match WYDBot parser frame sizes", () => {
  const attack = buildWyd727BasicAttackResultBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    targetMobIndex: 0xfff0,
    damage: 36,
  });
  assert.equal(attack.length + 4, 72);
  assert.equal(attack.readUInt16LE(0), 0x39d);
  assert.equal(attack.readUInt16LE(52), 0);
  assert.equal(attack.readUInt16LE(56), 0xfff0);
  assert.equal(attack.readInt32LE(60), 36);
  assert.deepEqual(inspectWyd727ServerFrame(attack), {
    recognized: true,
    malformed: false,
    opcode: 0x39d,
    name: "single-attack-result",
    frameLength: 72,
    expectedFrameLength: 72,
    lengthKnown: true,
    lengthValid: true,
  });

  const skillAttack = buildWyd727BasicAttackResultBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    targetMobIndex: 0xfff0,
    damage: 47,
    skillCode: 25,
  });
  assert.equal(skillAttack.readUInt16LE(52), 25);
  assert.equal(skillAttack.readInt32LE(60), 47);

  const death = buildWyd727MonsterDeathBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    killed: 0xfff0,
    killer: 0x1234,
    experienceGained: 40,
  });
  assert.equal(death.length + 4, 32);
  assert.equal(death.readUInt16LE(0), 0x338);
  assert.equal(death.readUInt16LE(12), 0xfff0);
  assert.equal(death.readUInt16LE(14), 0x1234);
  assert.equal(death.readBigInt64LE(20), 40n);
  assert.deepEqual(inspectWyd727ServerFrame(death), {
    recognized: true,
    malformed: false,
    opcode: 0x338,
    name: "mob-death",
    frameLength: 32,
    expectedFrameLength: 32,
    lengthKnown: true,
    lengthValid: true,
  });

  const respawn = buildWyd727MonsterRespawnStateBody({
    entityId: 0xfff0,
    timestamp: 0x10203040,
  });
  assert.equal(respawn.length + 4, 20);
  assert.equal(respawn.readUInt16LE(0), 0x36a);
  assert.equal(respawn.readUInt16LE(2), 0xfff0);
  assert.equal(respawn.readInt16LE(10), 2);
  assert.deepEqual(inspectWyd727ServerFrame(respawn), {
    recognized: true,
    malformed: false,
    opcode: 0x36a,
    name: "mob-state-delta",
    frameLength: 20,
    expectedFrameLength: 20,
    lengthKnown: true,
    lengthValid: true,
  });

  const hpSync = buildWyd727PlayerHpMpSyncBody({
    clientId: 0x1234,
    timestamp: 0x10203040,
    currentHp: 152,
    currentMp: 130,
  });
  assert.equal(hpSync.length + 4, 20);
  assert.equal(hpSync.readUInt16LE(0), 0x181);
  assert.equal(hpSync.readUInt16LE(2), 0x1234);
  assert.equal(hpSync.readInt32LE(8), 152);
  assert.equal(hpSync.readInt32LE(12), 130);
  assert.deepEqual(inspectWyd727ServerFrame(hpSync), {
    recognized: true,
    malformed: false,
    opcode: 0x181,
    name: "compact-hp-mp-sync",
    frameLength: 20,
    expectedFrameLength: 20,
    lengthKnown: true,
    lengthValid: true,
  });
});
