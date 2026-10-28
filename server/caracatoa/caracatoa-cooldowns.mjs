export const CARACATOA_MAX_EQUIPMENT_COOLDOWN_REDUCTION_BPS = 1_000;
export const CARACATOA_MAX_ITEM_COOLDOWN_REDUCTION_BPS = 400;
export const CARACATOA_MIN_SKILL_COOLDOWN_MS = 250;

export function computeCaracatoaSkillCooldownMs(baseCooldownMs, reductionBps = 0) {
  if (!Number.isSafeInteger(baseCooldownMs) || baseCooldownMs < 1 || baseCooldownMs > 120_000) {
    throw new RangeError("Recarga-base da habilidade inválida.");
  }
  if (
    !Number.isSafeInteger(reductionBps) ||
    reductionBps < 0 ||
    reductionBps > CARACATOA_MAX_EQUIPMENT_COOLDOWN_REDUCTION_BPS
  ) {
    throw new RangeError("Redução de recarga excede o teto Caracatoa de 10%.");
  }

  const remainingBps = BigInt(10_000 - reductionBps);
  const scaledCooldown =
    (BigInt(baseCooldownMs) * remainingBps + 9_999n) / 10_000n;
  return Math.max(
    CARACATOA_MIN_SKILL_COOLDOWN_MS,
    Number(scaledCooldown),
  );
}
