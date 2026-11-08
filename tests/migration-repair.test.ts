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

function createAdapter(database: Database, failFeeMarkerOnce = false) {
  let shouldFailMarker = failFeeMarkerOnce;
  return {
    execAsync: async (statement: string) => database.run(statement),
    runAsync: async (statement: string, params: SqlValue[] = []) => {
      if (shouldFailMarker && params[0] === 'debt_payment_fee_wallet_repair_v1') {
        shouldFailMarker = false;
        throw new Error('Simulated interruption before repair marker');
      }
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

describe('SQLite migration repair atomicity', () => {
  it('rolls back fee credits when the completion marker fails, then retries exactly once', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initSqlJs: () => Promise<SqlJsModule> = require('sql.js/dist/sql-asm.js');
    const SQL = await initSqlJs();
    const database = new SQL.Database();

    try {
      const normalDb = createAdapter(database);
      await migrateDbIfNeeded(normalDb as any);
      await normalDb.runAsync("UPDATE wallets SET balance = 1000 WHERE channel = 'GCASH'");
      await normalDb.runAsync(
        "INSERT INTO customers (id, name, created_at) VALUES (1, 'Legacy debtor', '2026-01-01T00:00:00.000Z')"
      );
      await normalDb.runAsync(
        "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (1, 'E_LOAD', 20, 0, 'GCASH', 1, 1, 0, '2026-01-01T00:00:00.000Z')"
      );
      await normalDb.runAsync(
        "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (2, 'DEBT_PAYMENT', 10, 2, 'GCASH', 1, 0, 0, '2026-01-02T00:00:00.000Z')"
      );

      // Model a legacy balance where the payment principal was credited but
      // its separately recorded fee was not.
      await normalDb.runAsync("UPDATE wallets SET balance = 990 WHERE channel = 'GCASH'");
      await normalDb.runAsync("DELETE FROM settings WHERE key = 'debt_payment_fee_wallet_repair_v1'");

      const interruptedDb = createAdapter(database, true);
      await expect(migrateDbIfNeeded(interruptedDb as any))
        .rejects.toThrow('Simulated interruption before repair marker');

      let balance = await normalDb.getFirstAsync<{ balance: number }>(
        "SELECT balance FROM wallets WHERE channel = 'GCASH'"
      );
      expect(balance?.balance).toBe(990);

      // A subsequent startup can safely retry because the failed attempt
      // rolled its wallet update and marker write back together.
      await migrateDbIfNeeded(normalDb as any);
      balance = await normalDb.getFirstAsync<{ balance: number }>(
        "SELECT balance FROM wallets WHERE channel = 'GCASH'"
      );
      expect(balance?.balance).toBe(992);

      await migrateDbIfNeeded(normalDb as any);
      balance = await normalDb.getFirstAsync<{ balance: number }>(
        "SELECT balance FROM wallets WHERE channel = 'GCASH'"
      );
      expect(balance?.balance).toBe(992);
    } finally {
      database.close();
      jest.restoreAllMocks();
    }
  });
});
