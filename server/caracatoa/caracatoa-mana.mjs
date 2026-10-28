export const CARACATOA_MAX_EQUIPMENT_MP_COST_REDUCTION_BPS = 1_500;
export const CARACATOA_MAX_ITEM_MP_COST_REDUCTION_BPS = 500;
const BASIS_POINTS = 10_000;

export function computeCaracatoaSkillManaCost(baseCost, reductionBps = 0) {
  if (!Number.isSafeInteger(baseCost) || baseCost < 1) {
    throw new RangeError("Custo base de mana inválido.");
  }
  if (
    !Number.isSafeInteger(reductionBps) ||
    reductionBps < 0 ||
    reductionBps > CARACATOA_MAX_EQUIPMENT_MP_COST_REDUCTION_BPS
  ) {
    throw new RangeError("Redução de custo de mana excede o teto Caracatoa de 15%.");
  }

  const remainingBps = BigInt(BASIS_POINTS - reductionBps);
  const scaledCost =
    (BigInt(baseCost) * remainingBps + BigInt(BASIS_POINTS - 1)) /
    BigInt(BASIS_POINTS);
  return Number(scaledCost > 0n ? scaledCost : 1n);
}
