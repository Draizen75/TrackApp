/** Strict decimal input validation for monetary fields. Rejects parseFloat prefixes such as "150abc". */
export function isValidMoneyInput(value: string, allowZero: boolean): boolean {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return false;
  const amount = Number(normalized);
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0);
}

/**
 * Converts the settlement principal field into its principal/profit split.
 * An empty field is intentionally treated as zero so profit-only settlements
 * cannot retain a stale principal amount from an earlier input.
 */
export function getSettlementPrincipalBreakdown(
  value: string,
  principalCap: number,
): { principal: number; excess: number } | null {
  const normalized = value.trim();
  if (normalized === '') return { principal: 0, excess: 0 };
  if (!isValidMoneyInput(normalized, true)) return null;

  const enteredPrincipal = Number(normalized);
  const safeCap = Number.isFinite(principalCap) ? Math.max(0, principalCap) : 0;
  return {
    principal: Math.min(enteredPrincipal, safeCap),
    excess: Math.max(0, enteredPrincipal - safeCap),
  };
}
