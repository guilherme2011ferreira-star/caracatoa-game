import assert from "node:assert/strict";
import test from "node:test";
import {
  CARACATOA_MAX_DAMAGE_ABSORPTION_BPS,
  combineCaracatoaDamageAbsorptionBps,
  computeCaracatoaDamageAfterAbsorption,
  computeCaracatoaCounterattackDamage,
  computeCaracatoaDamage,
  computeCaracatoaMagicAttackPower,
} from "./caracatoa-combat.mjs";

test("Caracatoa v1 damage adds attack, skill and selected attribute before defense", () => {
  assert.equal(
    computeCaracatoaDamage({
      attackPower: 41,
      skillBonus: 14,
      attributeBonus: 3,
      defense: 5,
    }),
    53,
  );
  assert.equal(
    computeCaracatoaDamage({ attackPower: 41, defense: 5 }),
    36,
  );
});

test("damage always chips for one while counterattacks may be fully absorbed", () => {
  assert.equal(
    computeCaracatoaDamage({ attackPower: 4, skillBonus: 1, defense: 100 }),
    1,
  );
  assert.equal(computeCaracatoaCounterattackDamage(5, 7), 0);
  assert.equal(computeCaracatoaCounterattackDamage(18, 0), 18);
});

test("damage caps raw power at Int32 and rejects invalid combat values", () => {
  assert.equal(
    computeCaracatoaDamage({
      attackPower: 0x7fffffff,
      skillBonus: 0x7fffffff,
      defense: 0,
    }),
    0x7fffffff,
  );
  assert.throws(
    () => computeCaracatoaDamage({ attackPower: -1, defense: 0 }),
    RangeError,
  );
  assert.throws(
    () => computeCaracatoaDamage({ attackPower: 1, defense: Number.NaN }),
    RangeError,
  );
});

test("equipment and mount absorption share the configured 10% combat cap", () => {
  assert.equal(CARACATOA_MAX_DAMAGE_ABSORPTION_BPS, 1000);
  assert.equal(computeCaracatoaDamageAfterAbsorption(50, 200), 49);
  assert.equal(computeCaracatoaDamageAfterAbsorption(50, 1000), 45);
  assert.equal(computeCaracatoaDamageAfterAbsorption(1, 1000), 1);
  assert.equal(computeCaracatoaDamageAfterAbsorption(0, 1000), 0);
  assert.throws(() => computeCaracatoaDamageAfterAbsorption(50, 1600), RangeError);
  assert.equal(combineCaracatoaDamageAbsorptionBps(900, 500), 1000);
  assert.equal(combineCaracatoaDamageAbsorptionBps(200, 300), 500);
  assert.throws(() => combineCaracatoaDamageAbsorptionBps(1001, 0), RangeError);
});

test("magic attack combines INT, staff, mount, and the 18% equipment cap", () => {
  assert.equal(
    computeCaracatoaMagicAttackPower({
      baseAttack: 10,
      intelligenceBonus: 5,
      equipmentMagicAttack: 1,
      mountMagicAttack: 2,
      magicAttackBps: 800,
    }),
    19,
  );
  assert.equal(
    computeCaracatoaMagicAttackPower({
      baseAttack: 10,
      intelligenceBonus: 5,
      equipmentMagicAttack: 1,
      magicAttackBps: 1800,
    }),
    18,
  );
  assert.throws(
    () => computeCaracatoaMagicAttackPower({ baseAttack: 1, magicAttackBps: 1801 }),
    RangeError,
  );
  assert.throws(
    () => computeCaracatoaMagicAttackPower({ intelligenceBonus: -1 }),
    RangeError,
  );
});
