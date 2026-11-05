import { getDebtorPaymentLabel, isPaymentWithinDays } from '@/utils/debtor-payment-label';

describe('debtor payment activity label', () => {
  const today = new Date(2026, 10, 5, 12);

  it('highlights a payment made today', () => {
    expect(getDebtorPaymentLabel(new Date(2026, 10, 5, 8).toISOString(), today))
      .toEqual({ label: 'Paid today', isRecent: true });
  });

  it('highlights a payment made yesterday', () => {
    expect(getDebtorPaymentLabel(new Date(2026, 10, 4, 8).toISOString(), today))
      .toEqual({ label: 'Paid yesterday', isRecent: true });
  });

  it('keeps older payment activity visible without calling it recent', () => {
    expect(getDebtorPaymentLabel(new Date(2026, 10, 2, 8).toISOString(), today))
      .toEqual({ label: 'Paid 3 days ago', isRecent: false });
  });

  it('matches payments in the last seven calendar days but excludes older and future payments', () => {
    expect(isPaymentWithinDays(new Date(2026, 9, 30, 8).toISOString(), 7, today)).toBe(true);
    expect(isPaymentWithinDays(new Date(2026, 9, 29, 8).toISOString(), 7, today)).toBe(false);
    expect(isPaymentWithinDays(new Date(2026, 10, 6, 8).toISOString(), 7, today)).toBe(false);
    expect(isPaymentWithinDays(null, 7, today)).toBe(false);
  });
});
