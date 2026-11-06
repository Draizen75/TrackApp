import { getReceiptPaymentBreakdown } from '@/utils/transaction-receipt';

describe('transaction receipt payment breakdown', () => {
  it('shows principal plus extra profit as the total received for a debt payment', () => {
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: 55, fee: 10 })).toEqual({
      principal: 55,
      extraProfit: 10,
      totalReceived: 65,
    });
  });

  it('keeps profit-only payments valid with zero principal', () => {
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: 0, fee: 25 })).toEqual({
      principal: 0,
      extraProfit: 25,
      totalReceived: 25,
    });
  });

  it('does not treat ordinary transaction service fees as debt-payment profit', () => {
    expect(getReceiptPaymentBreakdown({ type: 'CASH_IN', amount: 100, fee: 5 })).toEqual({
      principal: 100,
      extraProfit: 0,
      totalReceived: 100,
    });
  });

  it('normalizes missing and invalid numeric values safely', () => {
    expect(getReceiptPaymentBreakdown({ type: 'DEBT_PAYMENT', amount: undefined, fee: 'invalid' })).toEqual({
      principal: 0,
      extraProfit: 0,
      totalReceived: 0,
    });
  });
});
