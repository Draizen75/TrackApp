/** Strict decimal input validation for monetary fields. Rejects parseFloat prefixes such as "150abc". */
export function isValidMoneyInput(value: string, allowZero: boolean): boolean {
  const normalized = value.trim();
  if (!/^\\d+(?:\\.\\d{0,2})?$/.test(normalized)) return false;
  const amount = Number(normalized);
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0);
}
