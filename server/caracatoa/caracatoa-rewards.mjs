export const CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS = 800;

/** Apply a server-owned equipment reward bonus using integer basis points. */
export function computeCaracatoaRewardWithEquipmentBonus(baseReward, bonusBps) {
  if (!Number.isSafeInteger(baseReward) || baseReward < 0) {
    throw new RangeError("Recompensa base precisa ser um inteiro não negativo.");
  }
  if (
    !Number.isSafeInteger(bonusBps) ||
    bonusBps < 0 ||
    bonusBps > CARACATOA_MAX_EQUIPMENT_REWARD_BONUS_BPS
  ) {
    throw new RangeError("Bônus de recompensa do equipamento fora do limite.");
  }
  const adjusted =
    (BigInt(baseReward) * (10_000n + BigInt(bonusBps))) / 10_000n;
  if (adjusted > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Recompensa ajustada excede o inteiro seguro.");
  }
  return Number(adjusted);
}
