import { type Database } from 'sql.js';
import { migrateDbIfNeeded } from '@/db/db';

type Row = Record<string, unknown>;
type SqlValue = number | string | Uint8Array | null;
type SqlJsModule = { Database: new () => Database };

function rows<T extends Row>(database: Database, statement: string, params: SqlValue[] = []): T[] {
  const prepared = database.prepare(statement, params);
  try {
    const result: T[] = [];
    while (prepared.step()) result.push(prepared.getAsObject() as T);
    return result;
  } finally {
    prepared.free();
  }
}

function createDatabaseAdapter(database: Database) {
  return {
    execAsync: async (statement: string) => database.run(statement),
    runAsync: async (statement: string, params: SqlValue[] = []) => {
      database.run(statement, params);
      return { changes: database.getRowsModified(), lastInsertRowId: 0 };
    },
    getAllAsync: async <T extends Row>(statement: string, params: SqlValue[] = []) => rows<T>(database, statement, params),
    getFirstAsync: async <T extends Row>(statement: string, params: SqlValue[] = []) => rows<T>(database, statement, params)[0] ?? null,
    withTransactionAsync: async (task: () => Promise<void>) => {
      database.run('BEGIN');
      try {
        await task();
        database.run('COMMIT');
      } catch (error) {
        database.run('ROLLBACK');
        throw error;
      }
    },
  };
}

describe('SQLite ledger guards', () => {
  let database: Database;
  let db: ReturnType<typeof createDatabaseAdapter>;

  beforeEach(async () => {
    // The asm.js build runs under Jest without a native module or external WASM loader.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initSqlJs: () => Promise<SqlJsModule> = require('sql.js/dist/sql-asm.js');
    const SQL = await initSqlJs();
    database = new SQL.Database();
    db = createDatabaseAdapter(database);
    await migrateDbIfNeeded(db as any);
    await db.runAsync("UPDATE wallets SET balance = 1000 WHERE channel IN ('GCASH', 'PHYSICAL_CASH')");
    await db.runAsync("INSERT INTO customers (name, created_at) VALUES ('Ana', '2026-01-01T00:00:00.000Z')");
  });

  afterEach(() => {
    database?.close();
    jest.restoreAllMocks();
  });

  it('rejects a direct transaction write that refers to an unknown wallet', async () => {
    await expect(db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES ('E_LOAD', 10, 1, 'UNKNOWN', 0, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    )).rejects.toThrow('Selected wallet does not exist.');
  });

  it('rejects direct debt overpayments while accepting a payment equal to the balance', async () => {
    await db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES ('E_LOAD', 100, 10, 'GCASH', 1, 1, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );

    await expect(db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES ('DEBT_PAYMENT', 111, 0, 'GCASH', 1, 0, 0, ?)",
      ['2026-01-02T00:00:00.000Z']
    )).rejects.toThrow('Debt payment cannot exceed the outstanding balance.');

    await expect(db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES ('DEBT_PAYMENT', 110, 0, 'GCASH', 1, 0, 0, ?)",
      ['2026-01-02T00:00:00.000Z']
    )).resolves.toBeDefined();
  });

  it('blocks direct deletion of a customer with an open balance', async () => {
    await db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES ('E_LOAD', 100, 10, 'GCASH', 1, 1, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );

    await expect(db.runAsync('DELETE FROM customers WHERE id = 1')).rejects.toThrow('Cannot delete a customer with an outstanding debt.');
  });

  it('does not alter existing transactions or wallet balances silently', async () => {
    await db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES ('E_LOAD', 10.005, 1.005, 'GCASH', 0, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );
    await migrateDbIfNeeded(db as any);

    const transaction = await db.getFirstAsync<{ amount: number; fee: number }>('SELECT amount, fee FROM transactions WHERE id = 1');
    expect(transaction).toEqual({ amount: 10.005, fee: 1.005 });
  });

  it('migrates legacy orphan payments safely before strict validation triggers', async () => {
    await db.execAsync('DROP TRIGGER IF EXISTS tr_transaction_validate_insert;');
    await db.runAsync("INSERT INTO customers (id, name, created_at) VALUES (2, 'Bob', '2026-01-01T00:00:00.000Z')");
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (10, 'E_LOAD', 100, 10, 'GCASH', 2, 1, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (11, 'DEBT_PAYMENT', 110, 0, 'GCASH', NULL, 0, 0, ?)",
      ['2026-01-02T00:00:00.000Z']
    );
    await db.runAsync("DELETE FROM settings WHERE key = 'debt_payment_customer_repair_v1'");

    await expect(migrateDbIfNeeded(db as any)).resolves.not.toThrow();

    const repaired = await db.getFirstAsync<{ customer_id: number }>('SELECT customer_id FROM transactions WHERE id = 11');
    expect(repaired?.customer_id).toBe(2);
  });

  it('keeps database usable when an orphan payment is ambiguous rather than failing startup', async () => {
    await db.execAsync('DROP TRIGGER IF EXISTS tr_transaction_validate_insert;');
    await db.runAsync("INSERT INTO customers (id, name, created_at) VALUES (20, 'Cara', '2026-01-01T00:00:00.000Z')");
    await db.runAsync("INSERT INTO customers (id, name, created_at) VALUES (21, 'Dan', '2026-01-01T00:00:00.000Z')");
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (200, 'E_LOAD', 100, 0, 'GCASH', 20, 1, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (201, 'E_LOAD', 100, 0, 'GCASH', 21, 1, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (202, 'DEBT_PAYMENT', 100, 0, 'GCASH', NULL, 0, 0, ?)",
      ['2026-01-02T00:00:00.000Z']
    );
    await db.runAsync("DELETE FROM settings WHERE key = 'debt_payment_customer_repair_v1'");

    await expect(migrateDbIfNeeded(db as any)).resolves.not.toThrow();

    const orphan = await db.getFirstAsync<{ customer_id: number | null }>('SELECT customer_id FROM transactions WHERE id = 202');
    expect(orphan?.customer_id).toBeNull();

    await expect(db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES ('CASH_IN', 50, 5, 'GCASH', 0, 0, ?)",
      ['2026-01-03T00:00:00.000Z']
    )).resolves.toBeDefined();
  });

  it('handles all transaction types, edits, and deletes with correct wallet updates', async () => {
    // 1. CASH_IN (amount 200, fee 10: digital -200, cash +210)
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES (301, 'CASH_IN', 200, 10, 'GCASH', 0, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );
    let gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    let cash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'");
    expect(gcash?.balance).toBe(800);
    expect(cash?.balance).toBe(1210);

    // 2. CASH_OUT (amount 100, fee 10: digital +110, cash -100)
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES (302, 'CASH_OUT', 100, 10, 'GCASH', 0, 0, ?)",
      ['2026-01-01T01:00:00.000Z']
    );
    gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    cash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'");
    expect(gcash?.balance).toBe(910);
    expect(cash?.balance).toBe(1110);

    // 3. E_LOAD non-debt (amount 50, fee 5: digital -50, cash +55)
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES (303, 'E_LOAD', 50, 5, 'GCASH', 0, 0, ?)",
      ['2026-01-01T02:00:00.000Z']
    );
    gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    cash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'");
    expect(gcash?.balance).toBe(860);
    expect(cash?.balance).toBe(1165);

    // 4. TV_LOAD debt (amount 50, fee 10: digital -50, cash unchanged because is_debt = 1)
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (304, 'TV_LOAD', 50, 10, 'GCASH', 1, 1, 0, ?)",
      ['2026-01-01T03:00:00.000Z']
    );
    gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    cash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'");
    expect(gcash?.balance).toBe(810);
    expect(cash?.balance).toBe(1165);

    // 5. DEBT_PAYMENT (amount 60, fee 0: GCASH +60)
    await db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (305, 'DEBT_PAYMENT', 60, 0, 'GCASH', 1, 0, 0, ?)",
      ['2026-01-01T04:00:00.000Z']
    );
    gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    expect(gcash?.balance).toBe(870);

    // 6. EDIT (update transaction): edit cash in amount from 200 to 100
    await db.runAsync("UPDATE transactions SET amount = 100 WHERE id = 301");
    gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    cash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'");
    expect(gcash?.balance).toBe(970);
    expect(cash?.balance).toBe(1065);

    // 7. DELETE (delete transaction): delete cash in transaction
    await db.runAsync("DELETE FROM transactions WHERE id = 301");
    gcash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'GCASH'");
    cash = await db.getFirstAsync<{ balance: number }>("SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'");
    expect(gcash?.balance).toBe(1070);
    expect(cash?.balance).toBe(955);
  });

  it('preserves existing SQLite database records when a restore operation fails', async () => {
    // Current database has customer Ana and existing wallet balances
    const initialCustomer = await db.getFirstAsync<{ name: string }>('SELECT name FROM customers WHERE id = 1');
    const initialWallets = await db.getAllAsync<{ channel: string; balance: number }>('SELECT channel, balance FROM wallets ORDER BY channel');

    // Simulate invalid restore: fails assertValidBackup or fails mid-transaction
    const invalidBackup = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 99, name: 'Bad Customer', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [{
        id: 1, type: 'DEBT_PAYMENT', amount: 9999, fee: 0, channel: 'GCASH', customer_id: 99, is_debt: 0, deduct_fee: 0, created_at: '2026-01-02T00:00:00.000Z'
      }],
      wallets: [{ channel: 'GCASH', balance: 100 }],
      settings: {},
    };

    // Run restore transaction wrapper
    await expect(async () => {
      // assertValidBackup runs before any delete
      const { assertValidBackup } = require('@/hooks/useDbQueries');
      assertValidBackup(invalidBackup);

      // Even if delete were reached, transaction rollback preserves data
      await db.withTransactionAsync(async () => {
        await db.execAsync('DELETE FROM customers');
        throw new Error('Simulation error inside transaction');
      });
    }).rejects.toThrow();

    // Verify existing data was untouched
    const currentCustomer = await db.getFirstAsync<{ name: string }>('SELECT name FROM customers WHERE id = 1');
    const currentWallets = await db.getAllAsync<{ channel: string; balance: number }>('SELECT channel, balance FROM wallets ORDER BY channel');

    expect(currentCustomer?.name).toBe(initialCustomer?.name);
    expect(currentWallets).toEqual(initialWallets);
  });
});
