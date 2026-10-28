const INT32_MAX = 0x7fffffff;
export const CARACATOA_MAX_DAMAGE_ABSORPTION_BPS = 1000;
export const CARACATOA_MAX_EQUIPMENT_MAGIC_ATTACK_BPS = 1800;

export function combineCaracatoaDamageAbsorptionBps(
  equipmentAbsorptionBps = 0,
  mountAbsorptionBps = 0,
) {
  for (const [value, label] of [
    [equipmentAbsorptionBps, "equipmentAbsorptionBps"],
    [mountAbsorptionBps, "mountAbsorptionBps"],
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > CARACATOA_MAX_DAMAGE_ABSORPTION_BPS) {
      throw new RangeError(`${label} excede o teto Caracatoa de 10%.`);
    }
  }
  return Math.min(
    CARACATOA_MAX_DAMAGE_ABSORPTION_BPS,
    equipmentAbsorptionBps + mountAbsorptionBps,
  );
}

function assertCombatValue(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > INT32_MAX) {
    throw new RangeError(`${label} precisa ser um inteiro entre 0 e Int32.max.`);
  }
}

/**
 * Caracatoa v1 magic power scales the level-derived base, allocated INT, staff
 * attack and mount magic attack together. The equipped percentage is capped
 * at +18%; floor is applied once before skill damage and target defense.
 */
export function computeCaracatoaMagicAttackPower({
  baseAttack = 0,
  intelligenceBonus = 0,
  equipmentMagicAttack = 0,
  mountMagicAttack = 0,
  magicAttackBps = 0,
} = {}) {
  for (const [value, label] of [
    [baseAttack, "baseAttack"],
    [intelligenceBonus, "intelligenceBonus"],
    [equipmentMagicAttack, "equipmentMagicAttack"],
    [mountMagicAttack, "mountMagicAttack"],
  ]) {
    assertCombatValue(value, label);
  }
  if (
    !Number.isInteger(magicAttackBps) ||
    magicAttackBps < 0 ||
    magicAttackBps > CARACATOA_MAX_EQUIPMENT_MAGIC_ATTACK_BPS
  ) {
    throw new RangeError("magicAttackBps excede o teto Caracatoa de 18%.");
  }
  const unscaledPower = Math.min(
    INT32_MAX,
    baseAttack + intelligenceBonus + equipmentMagicAttack + mountMagicAttack,
  );
  return Math.min(
    INT32_MAX,
    Math.floor(unscaledPower * (10_000 + magicAttackBps) / 10_000),
  );
}

/**
 * Deterministic Caracatoa v1 damage rule:
 * max(1, min(Int32.max, attackPower + skillBonus + attributeBonus) - defense).
 * Attribute points are supplied by the authoritative character snapshot.
 */
export function computeCaracatoaDamage({
  attackPower,
  defense,
  skillBonus = 0,
  attributeBonus = 0,
} = {}) {
  assertCombatValue(attackPower, "attackPower");
  assertCombatValue(defense, "defense");
  assertCombatValue(skillBonus, "skillBonus");
  assertCombatValue(attributeBonus, "attributeBonus");
  const rawDamage = Math.min(
    INT32_MAX,
    attackPower + skillBonus + attributeBonus,
  );
  return Math.max(1, rawDamage - defense);
}

/** Monster retaliation may deal zero damage after player defense. */
export function computeCaracatoaCounterattackDamage(
  monsterDamage,
  playerDefense,
) {
  assertCombatValue(monsterDamage, "monsterDamage");
  assertCombatValue(playerDefense, "playerDefense");
  return Math.max(0, monsterDamage - playerDefense);
}

/**
 * Caracatoa v1 combines gear and mount absorption under the shared 10% cap.
 * Counterattacks can still reach zero after defense or absorption.
 */
export function computeCaracatoaDamageAfterAbsorption(
  incomingDamage,
  absorptionBps = 0,
) {
  assertCombatValue(incomingDamage, "incomingDamage");
  if (!Number.isInteger(absorptionBps) || absorptionBps < 0 ||
      absorptionBps > CARACATOA_MAX_DAMAGE_ABSORPTION_BPS) {
    throw new RangeError("absorptionBps excede o teto Caracatoa de 10%.");
  }
  if (incomingDamage === 0) return 0;
  return Math.max(
    1,
    Math.floor(incomingDamage * (10_000 - absorptionBps) / 10_000),
  );
}
