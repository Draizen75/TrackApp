export type DebtPaymentPreview = {
  contractualFeePaid: number;
  principalPaid: number;
  extraProfitPaid: number;
  debtApplied: number;
  totalReceived: number;
};

type DebtLedgerTransaction = {
  id: number;
  type: string;
  amount: number;
  fee: number;
  customer_id: number | null;
  is_debt: number;
  deduct_fee?: number;
  target_debt_id?: number | null;
  created_at: string;
};

/**
 * Previews a new debt payment using the same ledger rules as persisted
 * settlements: contractual fees on the debt are collected before principal.
 * The transaction amount is the amount applied to the debt; extraProfit is
 * additional cash received and is never used to reduce the debt balance.
 *
 * targetDebtIds preserves the statement's targeted-payment behavior. When it
 * is omitted, the payment follows the customer's FIFO debt order.
 */
export function calculateDebtPaymentPreview(
  customerTransactions: DebtLedgerTransaction[],
  debtApplied: number,
  extraProfit = 0,
  targetDebtIds?: number[],
): DebtPaymentPreview {
  const safeAmount = Number.isFinite(debtApplied) ? Math.max(0, Math.round((debtApplied + Number.EPSILON) * 100) / 100) : 0;
  const safeExtraProfit = Number.isFinite(extraProfit) ? Math.max(0, Math.round((extraProfit + Number.EPSILON) * 100) / 100) : 0;
  const debts: { id: number; principal: number; contractualFee: number; createdAt: string }[] = [];
  const debtById = new Map<number, (typeof debts)[number]>();
  let fifoIndex = 0;

  const apply = (debt: (typeof debts)[number], amount: number) => {
    let remaining = amount;
    const feePaid = Math.min(remaining, debt.contractualFee);
    debt.contractualFee = Math.round((debt.contractualFee - feePaid + Number.EPSILON) * 100) / 100;
    remaining = Math.round((remaining - feePaid + Number.EPSILON) * 100) / 100;
    const principalPaid = Math.min(remaining, debt.principal);
    debt.principal = Math.round((debt.principal - principalPaid + Number.EPSILON) * 100) / 100;
    return {
      contractualFeePaid: feePaid,
      principalPaid,
      remaining: Math.round((remaining - principalPaid + Number.EPSILON) * 100) / 100,
    };
  };

  const sorted = [...customerTransactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id,
  );
  for (const transaction of sorted) {
    if (transaction.is_debt === 1) {
      const debt = {
        id: transaction.id,
        principal: Math.max(0, Number(transaction.amount) || 0),
        contractualFee: transaction.deduct_fee === 1 ? 0 : Math.max(0, Number(transaction.fee) || 0),
        createdAt: transaction.created_at,
      };
      debts.push(debt);
      debtById.set(debt.id, debt);
      continue;
    }
    if (transaction.type !== 'DEBT_PAYMENT') continue;

    let remaining = Math.max(0, Number(transaction.amount) || 0);
    if (transaction.target_debt_id != null) {
      const target = debtById.get(transaction.target_debt_id);
      if (target) apply(target, remaining);
      continue;
    }
    while (remaining > 0 && fifoIndex < debts.length) {
      const debt = debts[fifoIndex];
      remaining = apply(debt, remaining).remaining;
      if (debt.principal <= 0 && debt.contractualFee <= 0) fifoIndex += 1;
    }
  }

  let remaining = safeAmount;
  let contractualFeePaid = 0;
  let principalPaid = 0;
  const applyNewPayment = (debt: (typeof debts)[number]) => {
    const result = apply(debt, remaining);
    contractualFeePaid = Math.round((contractualFeePaid + result.contractualFeePaid + Number.EPSILON) * 100) / 100;
    principalPaid = Math.round((principalPaid + result.principalPaid + Number.EPSILON) * 100) / 100;
    remaining = result.remaining;
  };

  if (targetDebtIds?.length) {
    const selected = new Set(targetDebtIds);
    for (const debt of debts) {
      if (remaining <= 0) break;
      if (selected.has(debt.id)) applyNewPayment(debt);
    }
  } else {
    while (remaining > 0 && fifoIndex < debts.length) {
      const debt = debts[fifoIndex];
      applyNewPayment(debt);
      if (debt.principal <= 0 && debt.contractualFee <= 0) fifoIndex += 1;
      else break;
    }
  }

  const debtAppliedTotal = Math.round((contractualFeePaid + principalPaid + Number.EPSILON) * 100) / 100;
  return {
    contractualFeePaid,
    principalPaid,
    extraProfitPaid: safeExtraProfit,
    debtApplied: debtAppliedTotal,
    totalReceived: Math.round((debtAppliedTotal + safeExtraProfit + Number.EPSILON) * 100) / 100,
  };
}
