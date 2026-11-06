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
  let primary: Database;

  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initSqlJs: () => Promise<SqlJsModule> = require('sql.js/dist/sql-asm.js');
    SQL = await initSqlJs();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    primary?.close();
  });

  it.each(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD'] as const)(
    'keeps an edited %s on PHYSICAL_CASH equivalent to deleting and recreating it',
    async (type) => {
      const edited = await createTestDatabase(SQL);
      const recreated = await createTestDatabase(SQL);
      primary = edited.database;

      const initialSql = `INSERT INTO transactions
        (id, type, amount, fee, channel, is_debt, deduct_fee, created_at)
        VALUES (701, ?, 100, 10, 'PHYSICAL_CASH', 0, 0, '2026-01-01T00:00:00.000Z')`;
      const replacementSql = `INSERT INTO transactions
        (id, type, amount, fee, channel, is_debt, deduct_fee, created_at)
        VALUES (702, ?, 120, 5, 'PHYSICAL_CASH', 0, 0, '2026-01-01T00:00:00.000Z')`;

      await edited.db.runAsync(initialSql, [type]);
      await edited.db.runAsync(
        "UPDATE transactions SET amount = 120, fee = 5 WHERE id = 701"
      );
      await recreated.db.runAsync(replacementSql, [type]);

      const editedBalances = await edited.db.getAllAsync<{ channel: string; balance: number }>(
        'SELECT channel, balance FROM wallets ORDER BY channel'
      );
      const recreatedBalances = await recreated.db.getAllAsync<{ channel: string; balance: number }>(
        'SELECT channel, balance FROM wallets ORDER BY channel'
      );

      expect(editedBalances).toEqual(recreatedBalances);
      expect(editedBalances.find((wallet) => wallet.channel === 'PHYSICAL_CASH')?.balance).toBe(1005);

      recreated.database.close();
    }
  );
});
