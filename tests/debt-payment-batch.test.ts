import { allocateTargetedDebtPayment, buildTargetedDebtPaymentRecords } from '@/utils/debt-payment-batch';

describe('targeted batch debt payments', () => {
  const selectedDebts = [
    { id: 10, outstanding: 55 },
    { id: 11, outstanding: 55 },
    { id: 12, outstanding: 55 },
    { id: 13, outstanding: 2550 },
  ];

  it('settles only the selected load debts', () => {
    expect(allocateTargetedDebtPayment(selectedDebts.slice(0, 3), 165)).toEqual([
      { targetDebtId: 10, amount: 55 },
      { targetDebtId: 11, amount: 55 },
      { targetDebtId: 12, amount: 55 },
    ]);
  });

  it('applies a partial payment to selected debts in ledger order', () => {
    expect(allocateTargetedDebtPayment(selectedDebts.slice(0, 3), 100)).toEqual([
      { targetDebtId: 10, amount: 55 },
      { targetDebtId: 11, amount: 45 },
    ]);
  });

  it('does not create payment records for zero or negative received amounts', () => {
    expect(allocateTargetedDebtPayment(selectedDebts, 0)).toEqual([]);
    expect(allocateTargetedDebtPayment(selectedDebts, -10)).toEqual([]);
  });

  it('skips already-settled debts and continues in ledger order', () => {
    expect(allocateTargetedDebtPayment([
      { id: 20, outstanding: 0 },
      { id: 21, outstanding: 12.5 },
      { id: 22, outstanding: 7.5 },
    ], 15)).toEqual([
      { targetDebtId: 21, amount: 12.5 },
      { targetDebtId: 22, amount: 2.5 },
    ]);
  });

  it('returns no records when no debts are selected', () => {
    expect(allocateTargetedDebtPayment([], 100)).toEqual([]);
  });


  it('creates one targeted transaction per debt and credits batch profit only once', () => {
    const rows = buildTargetedDebtPaymentRecords(selectedDebts.slice(0, 3), 100, 7.5);
    expect(rows).toEqual([
      { targetDebtId: 10, amount: 55, fee: 7.5 },
      { targetDebtId: 11, amount: 45, fee: 0 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(100);
    expect(rows.reduce((sum, row) => sum + row.fee, 0)).toBe(7.5);
    expect(rows.reduce((sum, row) => sum + row.amount + row.fee, 0)).toBe(107.5);
  });

  it('keeps profit-only settlements as one zero-principal payment row', () => {
    expect(buildTargetedDebtPaymentRecords([{ id: 10, outstanding: 55 }], 0, 12)).toEqual([
      { targetDebtId: 10, amount: 0, fee: 12 },
    ]);
  });

  it('preserves un-targeted single-debt settlement behavior', () => {
    expect(buildTargetedDebtPaymentRecords([], 40, 5)).toEqual([
      { targetDebtId: null, amount: 40, fee: 5 },
    ]);
  });

  it('retains one ledger row for zero-principal profit on an empty selection', () => {
    expect(buildTargetedDebtPaymentRecords([], 0, 5)).toEqual([
      { targetDebtId: null, amount: 0, fee: 5 },
    ]);
  });

  it('does not allocate more than the selected debt balance', () => {
    expect(allocateTargetedDebtPayment([{ id: 13, outstanding: 2550 }], 2600)).toEqual([
      { targetDebtId: 13, amount: 2550 },
    ]);
  });
});
