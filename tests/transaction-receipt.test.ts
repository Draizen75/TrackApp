import { getReceiptPaymentBreakdown } from '@/utils/transaction-receipt';
import { buildTargetedDebtPaymentRecords } from '@/utils/debt-payment-batch';

describe('transaction receipt payment breakdown', () => {
  it('shows debt-applied amount plus extra profit as the total received for a debt payment', () => {
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: 55, fee: 10 })).toEqual({
      debtApplied: 55,
      extraProfit: 10,
      totalReceived: 65,
    });
  });

  it('keeps profit-only payments valid with zero debt-applied amount', () => {
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: 0, fee: 25 })).toEqual({
      debtApplied: 0,
      extraProfit: 25,
      totalReceived: 25,
    });
  });

  it('does not treat ordinary transaction service fees as debt-payment profit', () => {
    expect(getReceiptPaymentBreakdown({ type: 'CASH_IN', amount: 100, fee: 5 })).toEqual({
      debtApplied: 100,
      extraProfit: 0,
      totalReceived: 100,
    });
  });

  it('normalizes missing and invalid numeric values safely', () => {
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: undefined, fee: 'invalid' })).toEqual({
      debtApplied: 0,
      extraProfit: 0,
      totalReceived: 0,
    });
  });

  it('integrates with batch settlement rows and displays the batch profit exactly once', () => {
    const batchRows = buildTargetedDebtPaymentRecords(
      [
        { id: 10, outstanding: 55 },
        { id: 11, outstanding: 45 },
      ],
      100,
      7.5,
    );

    const receipts = batchRows.map((row) =>
      getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: row.amount, fee: row.fee }),
    );

    expect(receipts).toEqual([
      { debtApplied: 55, extraProfit: 7.5, totalReceived: 62.5 },
      { debtApplied: 45, extraProfit: 0, totalReceived: 45 },
    ]);
    expect(receipts.reduce((sum, receipt) => sum + receipt.debtApplied, 0)).toBe(100);
    expect(receipts.reduce((sum, receipt) => sum + receipt.extraProfit, 0)).toBe(7.5);
    expect(receipts.reduce((sum, receipt) => sum + receipt.totalReceived, 0)).toBe(107.5);
  });

  it('keeps a batch profit-only record readable as one receipt', () => {
    const [row] = buildTargetedDebtPaymentRecords([{ id: 10, outstanding: 55 }], 0, 12);
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: row.amount, fee: row.fee })).toEqual({
      debtApplied: 0,
      extraProfit: 12,
      totalReceived: 12,
    });
  });
});
