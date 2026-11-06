export type ReceiptPaymentBreakdown = {
  principal: number;
  extraProfit: number;
  totalReceived: number;
};

export function getReceiptPaymentBreakdown(transaction: {
  type: string;
  amount: number | string | null | undefined;
  fee: number | string | null | undefined;
}): ReceiptPaymentBreakdown {
  const principal = Number(transaction.amount) || 0;
  const extraProfit = transaction.type === 'DEBT_PAYMENT' ? Number(transaction.fee) || 0 : 0;
  return { principal, extraProfit, totalReceived: principal + extraProfit };
}
