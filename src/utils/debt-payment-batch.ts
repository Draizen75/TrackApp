export type TargetedDebtBalance = {
  id: number;
  outstanding: number;
};

export type TargetedDebtPayment = {
  targetDebtId: number;
  amount: number;
};

/**
 * Splits one received principal amount across explicitly selected debts.
 * The caller supplies debts in their ledger order, making partial payments
 * deterministic and never allowing a selected debt to be overpaid.
 */
export function allocateTargetedDebtPayment(
  selectedDebts: TargetedDebtBalance[],
  receivedAmount: number,
): TargetedDebtPayment[] {
  let remaining = receivedAmount;
  const payments: TargetedDebtPayment[] = [];

  for (const debt of selectedDebts) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, debt.outstanding);
    if (amount > 0) {
      payments.push({ targetDebtId: debt.id, amount });
      remaining -= amount;
    }
  }

  return payments;
}
