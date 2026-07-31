const RATIO_PRECISION = 9

/** Calculates a selling ratio from a target gross margin percentage. */
export function calculateGrossMarginAdjustedRatio(currentRatio: number, grossMarginPct: number) {
  if (
    !Number.isFinite(currentRatio) ||
    currentRatio <= 0 ||
    !Number.isFinite(grossMarginPct) ||
    grossMarginPct < 0 ||
    grossMarginPct >= 100
  ) {
    return null
  }
  return Number((currentRatio / (1 - grossMarginPct / 100)).toFixed(RATIO_PRECISION))
}
