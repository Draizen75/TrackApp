import {
  assertValidBackup,
  assertValidTransactionInput,
  calculateDebtPaymentAllocation,
  calculateLedgerDebtAllocation,
  repairBackupDebtPaymentCustomers,
  roundCurrency,
  type BackupData,
  type Transaction,
} from '@/hooks/useDbQueries';

const debt: Transaction = {
  id: 1,
  type: 'E_LOAD',
  amount: 100,
  fee: 10,
  channel: 'GCASH',
  customer_id: 1,
  is_debt: 1,
  deduct_fee: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

const payment: Transaction = {
  id: 2,
  type: 'DEBT_PAYMENT',
  amount: 110,
  fee: 40,
  channel: 'GCASH',
  customer_id: 1,
  is_debt: 0,
  deduct_fee: 0,
  created_at: '2026-01-02T00:00:00.000Z',
};

describe('ledger safety rules', () => {
  it('allocates a settlement to principal, contractual earnings, and extra profit', () => {
    expect(calculateDebtPaymentAllocation([debt, payment])).toEqual({
      principalPaid: 100,
      contractualEarningsPaid: 10,
      extraProfitPaid: 40,
      pendingPrincipal: 0,
      pendingEarnings: 0,
    });
    expect(calculateLedgerDebtAllocation([debt, payment])).toEqual({
      principalPaid: 100,
      contractualEarningsPaid: 10,
      extraProfitPaid: 40,
      pendingPrincipal: 0,
      pendingEarnings: 0,
    });
  });

  it('rounds new money inputs to cent precision', () => {
    expect(roundCurrency(10.005)).toBe(10.01);
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });

  it('rejects debt payments with no customer or that are flagged as new debt', () => {
    expect(() => assertValidTransactionInput({
      type: 'DEBT_PAYMENT', amount: 10, fee: 0, channel: 'GCASH', customer_id: null, is_debt: false,
    })).toThrow('linked debtor');
    expect(() => assertValidTransactionInput({
      type: 'DEBT_PAYMENT', amount: 10, fee: 0, channel: 'GCASH', customer_id: 1, is_debt: true,
    })).toThrow('cannot be recorded as a new debt');
  });

  it('rejects deducted fees that exceed the transaction amount', () => {
    expect(() => assertValidTransactionInput({
      type: 'E_LOAD', amount: 10, fee: 11, channel: 'GCASH', customer_id: null, is_debt: false, deduct_fee: true,
    })).toThrow('deducted fee');
  });

  it('accepts a valid backup and rejects a transaction pointing to a missing wallet', () => {
    const backup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [debt],
      wallets: [{ channel: 'GCASH', balance: 100 }],
      settings: {},
    };
    expect(() => assertValidBackup(backup)).not.toThrow();
    expect(() => assertValidBackup({
      ...backup,
      transactions: [{ ...debt, channel: 'MISSING_WALLET' }],
    })).toThrow('invalid transaction reference');
  });

  it('repairs a uniquely identifiable legacy payment but rejects ambiguous orphan payments', () => {
    const legacyBackup: BackupData = {
      schema: 'trackapp.backup', version: 1, exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: debt.created_at }],
      transactions: [{ ...debt }, { ...payment, customer_id: null }],
      wallets: [{ channel: 'GCASH', balance: 100 }], settings: {},
    };
    const repaired = repairBackupDebtPaymentCustomers(legacyBackup);
    expect(repaired.transactions[1].customer_id).toBe(1);
    expect(() => assertValidBackup(repaired)).not.toThrow();

    expect(() => repairBackupDebtPaymentCustomers({
      ...legacyBackup,
      customers: [
        ...legacyBackup.customers,
        { id: 2, name: 'Ben', phone: null, created_at: debt.created_at },
      ],
      transactions: [
        { ...debt, id: 1, customer_id: 1 },
        { ...debt, id: 3, customer_id: 2 },
        { ...payment, customer_id: null },
      ],
    })).toThrow('cannot be linked uniquely');
  });
});
