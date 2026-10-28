import assert from "node:assert/strict";
import test from "node:test";
import {
  CARACATOA_MAX_EQUIPMENT_COOLDOWN_REDUCTION_BPS,
  CARACATOA_MIN_SKILL_COOLDOWN_MS,
  computeCaracatoaSkillCooldownMs,
} from "./caracatoa-cooldowns.mjs";

test("cooldown reduction is capped, rounded up, and keeps a minimum skill interval", () => {
  assert.equal(CARACATOA_MAX_EQUIPMENT_COOLDOWN_REDUCTION_BPS, 1_000);
  assert.equal(CARACATOA_MIN_SKILL_COOLDOWN_MS, 250);
  assert.equal(computeCaracatoaSkillCooldownMs(3_000), 3_000);
  assert.equal(computeCaracatoaSkillCooldownMs(3_000, 400), 2_880);
  assert.equal(computeCaracatoaSkillCooldownMs(3_000, 800), 2_760);
  assert.equal(computeCaracatoaSkillCooldownMs(999, 1_000), 900);
  assert.equal(computeCaracatoaSkillCooldownMs(1, 1_000), 250);
  assert.throws(() => computeCaracatoaSkillCooldownMs(0), /Recarga-base/);
  assert.throws(() => computeCaracatoaSkillCooldownMs(3_000, -1), /10%/);
  assert.throws(() => computeCaracatoaSkillCooldownMs(3_000, 1_001), /10%/);
});
