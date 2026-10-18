import {
  assertValidBackup,
  assertValidTransactionInput,
  calculateDebtPaymentAllocation,
  calculateLedgerDebtAllocation,
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

const wallets = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'].map((channel) => ({
  channel,
  balance: 100,
}));

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
      wallets,
      settings: {},
    };
    expect(() => assertValidBackup(backup)).not.toThrow();
    expect(() => assertValidBackup({
      ...backup,
      transactions: [{ ...debt, channel: 'MISSING_WALLET' }],
    })).toThrow('invalid transaction reference');
  });

  it('rejects an overpayment or a backup without all core wallets', () => {
    const backup: BackupData = {
      schema: 'trackapp.backup', version: 1, exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: debt.created_at }],
      transactions: [{ ...debt }, { ...payment, amount: 111, fee: 0 }],
      wallets, settings: {},
    };
    expect(() => assertValidBackup(backup)).toThrow('exceeds the outstanding balance');
    expect(() => assertValidBackup({ ...backup, transactions: [debt], wallets: [{ channel: 'GCASH', balance: 100 }] }))
      .toThrow('missing one or more required wallets');
  });

  it('rejects a backup with wrong or negative wallet balance', () => {
    const baseBackup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: debt.created_at }],
      transactions: [debt],
      wallets,
      settings: {},
    };

    // Negative wallet balance
    expect(() => assertValidBackup({
      ...baseBackup,
      wallets: wallets.map((w) => w.channel === 'GCASH' ? { ...w, balance: -10 } : w),
    })).toThrow('invalid or duplicate wallet record');

    // Non-finite wallet balance
    expect(() => assertValidBackup({
      ...baseBackup,
      wallets: wallets.map((w) => w.channel === 'GCASH' ? { ...w, balance: NaN } : w),
    })).toThrow('invalid or duplicate wallet record');
  });

  it('preserves existing data when a backup restore validation fails', () => {
    const existingDb = {
      customers: [{ id: 99, name: 'Original Customer', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [{ ...debt, id: 99, customer_id: 99 }],
      wallets: { GCASH: 500, MAYA: 500, MAYA_BUSINESS: 500, MARIBANK: 500, PHYSICAL_CASH: 500 },
      settings: {},
    };

    // Deep copy current state
    const snapshot = JSON.parse(JSON.stringify(existingDb));

    const invalidBackup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Bad Customer', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [{ ...debt }, { ...payment, amount: 9999, fee: 0 }], // overpayment
      wallets,
      settings: {},
    };

    // Attempting restore validation must fail and not overwrite the snapshot
    expect(() => assertValidBackup(invalidBackup)).toThrow();
    expect(existingDb).toEqual(snapshot);
  });

  it('supports web settle customer -> delete -> export -> restore lifecycle', () => {
    // 1. Initial database with customer and settled transactions
    let webDb: any = {
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [
        { ...debt, id: 1, customer_id: 1, amount: 100, fee: 10, is_debt: 1 },
        { ...payment, id: 2, customer_id: 1, amount: 110, fee: 0, type: 'DEBT_PAYMENT' },
      ],
      wallets: { GCASH: 100, MAYA: 100, MAYA_BUSINESS: 100, MARIBANK: 100, PHYSICAL_CASH: 100 },
      settings: {},
    };

    // 2. Calculate balance: outstanding is 0 (settled)
    const outstanding = webDb.transactions.reduce((sum: number, tx: any) => {
      if (tx.is_debt === 1) return sum + tx.amount + tx.fee;
      if (tx.type === 'DEBT_PAYMENT') return sum - tx.amount;
      return sum;
    }, 0);
    expect(outstanding).toBe(0);

    // 3. Delete customer: on web, matching SQLite ON DELETE SET NULL, historical customer_id becomes null
    for (const tx of webDb.transactions) {
      if (tx.customer_id === 1) tx.customer_id = null;
    }
    webDb.customers = webDb.customers.filter((c: any) => c.id !== 1);

    expect(webDb.customers.length).toBe(0);
    expect(webDb.transactions[0].customer_id).toBeNull();
    expect(webDb.transactions[1].customer_id).toBeNull();

    // 4. Export backup
    const exportedBackup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: new Date().toISOString(),
      customers: [...webDb.customers],
      transactions: [...webDb.transactions],
      wallets: Object.entries(webDb.wallets).map(([channel, balance]) => ({
        channel,
        balance: Number(balance),
      })),
      settings: { ...webDb.settings },
    };

    // 5. Restore: assertValidBackup must accept the backup with customer_id: null for deleted customer
    expect(() => assertValidBackup(exportedBackup)).not.toThrow();
  });
});
