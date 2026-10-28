import assert from "node:assert/strict";
import test from "node:test";
import {
  CARACATOA_MAX_EQUIPMENT_MP_COST_REDUCTION_BPS,
  computeCaracatoaSkillManaCost,
} from "./caracatoa-mana.mjs";

test("skill mana reduction applies a capped ceiling discount without zero-cost skills", () => {
  assert.equal(CARACATOA_MAX_EQUIPMENT_MP_COST_REDUCTION_BPS, 1_500);
  assert.equal(computeCaracatoaSkillManaCost(7), 7);
  assert.equal(computeCaracatoaSkillManaCost(7, 500), 7);
  assert.equal(computeCaracatoaSkillManaCost(7, 1_500), 6);
  assert.equal(computeCaracatoaSkillManaCost(1, 1_500), 1);
  assert.equal(computeCaracatoaSkillManaCost(10, 1_500), 9);
  assert.throws(() => computeCaracatoaSkillManaCost(0), /Custo base/);
  assert.throws(() => computeCaracatoaSkillManaCost(10, -1), /15%/);
  assert.throws(() => computeCaracatoaSkillManaCost(10, 1_501), /15%/);
});
