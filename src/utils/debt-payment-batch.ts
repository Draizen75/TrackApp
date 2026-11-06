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

export type TargetedDebtPaymentRecord = {
  targetDebtId: number | null;
  amount: number;
  fee: number;
};

/**
 * Produces the exact ledger rows shared by web and SQLite persistence.
 * Extra profit belongs to the settlement, not every debt allocation, so it
 * is attached to the first row exactly once (including profit-only rows).
 */
export function buildTargetedDebtPaymentRecords(
  selectedDebts: TargetedDebtBalance[],
  principalAmount: number,
  extraProfit: number,
): TargetedDebtPaymentRecord[] {
  const plan = selectedDebts.length
    ? allocateTargetedDebtPayment(selectedDebts, principalAmount)
    : [{ targetDebtId: null, amount: principalAmount }];
  const rows = plan.length
    ? plan
    : [{ targetDebtId: selectedDebts[0]?.id ?? null, amount: 0 }];

  return rows.map((payment, index) => ({
    ...payment,
    fee: index === 0 ? extraProfit : 0,
  }));
}
