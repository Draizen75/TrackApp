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

  it('rounds legacy transaction and wallet values to cents once', async () => {
    await db.runAsync(
      "INSERT INTO transactions (type, amount, fee, channel, is_debt, deduct_fee, created_at) VALUES ('E_LOAD', 10.005, 1.005, 'GCASH', 0, 0, ?)",
      ['2026-01-01T00:00:00.000Z']
    );
    await db.runAsync("DELETE FROM settings WHERE key = 'currency_rounding_repair_v1'");
    await migrateDbIfNeeded(db as any);

    const transaction = await db.getFirstAsync<{ amount: number; fee: number }>('SELECT amount, fee FROM transactions WHERE id = 1');
    expect(transaction).toEqual({ amount: 10.01, fee: 1.01 });
    const marker = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'currency_rounding_repair_v1'");
    expect(marker?.value).toBe('done');
  });
});
