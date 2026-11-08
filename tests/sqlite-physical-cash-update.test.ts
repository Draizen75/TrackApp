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

async function createTestDatabase(SQL: SqlJsModule) {
  const database = new SQL.Database();
  const db = createDatabaseAdapter(database);
  await migrateDbIfNeeded(db as any);
  await db.runAsync("UPDATE wallets SET balance = 1000");
  return { database, db };
}

describe('SQLite physical-cash transaction update reconciliation', () => {
  let SQL: SqlJsModule;
  const databases: Database[] = [];

  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initSqlJs: () => Promise<SqlJsModule> = require('sql.js/dist/sql-asm.js');
    SQL = await initSqlJs();
  });

  afterAll(() => {
    databases.forEach((database) => database.close());
    jest.restoreAllMocks();
  });

  it.each(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD'] as const)(
    'keeps the PHYSICAL_CASH counterpart correct when a %s transaction is edited',
    async (type) => {
      const edited = await createTestDatabase(SQL);
      const recreated = await createTestDatabase(SQL);
      databases.push(edited.database, recreated.database);

      await edited.db.runAsync(
        `INSERT INTO transactions (id, type, amount, fee, channel, is_debt, deduct_fee, created_at)
         VALUES (701, ?, 100, 10, 'GCASH', 0, 0, '2026-01-01T00:00:00.000Z')`,
        [type]
      );
      await edited.db.runAsync('UPDATE transactions SET amount = 120, fee = 5 WHERE id = 701');

      await recreated.db.runAsync(
        `INSERT INTO transactions (id, type, amount, fee, channel, is_debt, deduct_fee, created_at)
         VALUES (702, ?, 120, 5, 'GCASH', 0, 0, '2026-01-01T00:00:00.000Z')`,
        [type]
      );

      const editedCash = await edited.db.getFirstAsync<{ balance: number }>(
        "SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'"
      );
      const recreatedCash = await recreated.db.getFirstAsync<{ balance: number }>(
        "SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'"
      );

      expect(editedCash?.balance).toBe(recreatedCash?.balance);
    }
  );

  it('reverses and reapplies a DEBT_PAYMENT credited directly to PHYSICAL_CASH', async () => {
    const edited = await createTestDatabase(SQL);
    const recreated = await createTestDatabase(SQL);
    databases.push(edited.database, recreated.database);

    for (const db of [edited.db, recreated.db]) {
      await db.runAsync(
        "INSERT INTO customers (id, name, created_at) VALUES (1, 'Test debtor', '2026-01-01T00:00:00.000Z')"
      );
      await db.runAsync(
        "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (10, 'E_LOAD', 200, 0, 'GCASH', 1, 1, 0, '2026-01-01T00:00:00.000Z')"
      );
    }

    await edited.db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (11, 'DEBT_PAYMENT', 50, 2, 'PHYSICAL_CASH', 1, 0, 0, '2026-01-02T00:00:00.000Z')"
    );
    await edited.db.runAsync('UPDATE transactions SET amount = 75, fee = 3 WHERE id = 11');

    await recreated.db.runAsync(
      "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (12, 'DEBT_PAYMENT', 75, 3, 'PHYSICAL_CASH', 1, 0, 0, '2026-01-02T00:00:00.000Z')"
    );

    const editedCash = await edited.db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'"
    );
    const recreatedCash = await recreated.db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM wallets WHERE channel = 'PHYSICAL_CASH'"
    );
    expect(editedCash?.balance).toBe(recreatedCash?.balance);
  });
});
