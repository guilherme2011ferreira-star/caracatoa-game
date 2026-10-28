import assert from "node:assert/strict";
import test from "node:test";
import {
  CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS,
  computeCaracatoaRewardWithEquipmentBonus,
} from "./caracatoa-rewards.mjs";

test("equipment reward bonus uses deterministic integer basis-point scaling", () => {
  assert.equal(computeCaracatoaRewardWithEquipmentBonus(100, 150), 101);
  assert.equal(computeCaracatoaRewardWithEquipmentBonus(99, 150), 100);
  assert.equal(computeCaracatoaRewardWithEquipmentBonus(100, 0), 100);
  assert.equal(
    computeCaracatoaRewardWithEquipmentBonus(100, CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS),
    108,
  );
});

test("equipment reward bonus rejects client-like values outside the hard cap", () => {
  assert.throws(() => computeCaracatoaRewardWithEquipmentBonus(100, 801), /fora do limite/);
  assert.throws(() => computeCaracatoaRewardWithEquipmentBonus(-1, 0), /inteiro não negativo/);
  assert.throws(() => computeCaracatoaRewardWithEquipmentBonus(Number.MAX_SAFE_INTEGER, 800), /inteiro seguro/);
});
