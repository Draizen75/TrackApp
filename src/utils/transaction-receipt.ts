export type ReceiptPaymentBreakdown = {
  debtApplied: number;
  extraProfit: number;
  totalReceived: number;
};

export function getReceiptPaymentBreakdown(transaction: {
  type: string;
  amount: number | string | null | undefined;
  fee: number | string | null | undefined;
}): ReceiptPaymentBreakdown {
  const debtApplied = Number(transaction.amount) || 0;
  const extraProfit = transaction.type === 'DEBT_PAYMENT' ? Number(transaction.fee) || 0 : 0;
  return { debtApplied, extraProfit, totalReceived: debtApplied + extraProfit };
}
