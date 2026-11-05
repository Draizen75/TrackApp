import { calculateSuggestedEntryFee, getEntryPreviewRows } from '@/utils/entry-preview';

describe('quick entry previews', () => {
  it('calculates the suggested fee from the configured transaction rules', () => {
    const settings = {
      cash_step_amount: '500',
      cash_fee_per_step: '10',
      eload_threshold: '100',
      eload_fee_low: '5',
      eload_fee_high: '12',
      tvload_fee: '15',
    };

    expect(calculateSuggestedEntryFee('CASH_IN', 501, settings)).toBe(20);
    expect(calculateSuggestedEntryFee('E_LOAD', 99, settings)).toBe(5);
    expect(calculateSuggestedEntryFee('E_LOAD', 100, settings)).toBe(12);
    expect(calculateSuggestedEntryFee('TV_LOAD', 500, settings)).toBe(15);
  });

  it('shows the customer payment and wallet payout for cash-in transactions', () => {
    expect(getEntryPreviewRows({
      type: 'CASH_IN',
      amount: 1000,
      fee: 10,
      channelLabel: 'GCash',
      isDebt: false,
      deductFee: false,
    })).toEqual([
      { label: 'Customer pays', value: '₱1,010.00' },
      { label: 'GCash sent', value: '₱1,000.00' },
    ]);

    expect(getEntryPreviewRows({
      type: 'CASH_IN',
      amount: 1000,
      fee: 10,
      channelLabel: 'GCash',
      isDebt: true,
      deductFee: true,
    })).toEqual([
      { label: 'Debt added', value: '₱1,000.00' },
      { label: 'GCash sent', value: '₱990.00' },
    ]);
  });

  it('shows cash-out, load, and debt amounts without mislabeling the wallet flow', () => {
    expect(getEntryPreviewRows({
      type: 'CASH_OUT',
      amount: 500,
      fee: 10,
      channelLabel: 'Maya',
      isDebt: false,
      deductFee: true,
    })).toEqual([
      { label: 'Cash handed out', value: '₱490.00' },
      { label: 'Maya received', value: '₱500.00' },
    ]);

    expect(getEntryPreviewRows({
      type: 'E_LOAD',
      amount: 100,
      fee: 10,
      channelLabel: 'GCash',
      isDebt: true,
      deductFee: false,
    })).toEqual([
      { label: 'Debt added', value: '₱110.00' },
      { label: 'GCash load sent', value: '₱100.00' },
    ]);
  });
});
