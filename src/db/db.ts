import * as SQLite from 'expo-sqlite';

export async function migrateDbIfNeeded(db: SQLite.SQLiteDatabase) {
  // Optimize pragmas for safety, speed, and corruption resistance
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  // Create tables
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, -- 'CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD', 'DEBT_PAYMENT'
      amount REAL NOT NULL,
      fee REAL NOT NULL,
      channel TEXT NOT NULL, -- 'GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'
      customer_id INTEGER,
      is_debt INTEGER NOT NULL DEFAULT 0, -- 0 = False, 1 = True
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      channel TEXT NOT NULL DEFAULT 'PHYSICAL_CASH',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      channel TEXT PRIMARY KEY NOT NULL,
      balance REAL NOT NULL DEFAULT 0.0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  // Run dynamic migration block to alter existing databases cleanly
  try {
    await db.execAsync('ALTER TABLE transactions ADD COLUMN deduct_fee INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists
  }

  // Drop old triggers to redefine them
  await db.execAsync(`
    DROP TRIGGER IF EXISTS tr_transaction_insert;
    DROP TRIGGER IF EXISTS tr_transaction_delete;
  `);

  // Create SQLite triggers for transaction insertions
  await db.execAsync(`
    CREATE TRIGGER tr_transaction_insert
    AFTER INSERT ON transactions
    FOR EACH ROW
    BEGIN
      -- CASH_IN: digital wallet decreases by principal (minus fee if deducted)
      UPDATE wallets
      SET balance = balance - (NEW.amount - (CASE WHEN NEW.deduct_fee = 1 THEN NEW.fee ELSE 0 END))
      WHERE channel = NEW.channel AND NEW.type = 'CASH_IN';

      -- CASH_IN: cash-on-hand increases by principal + fee (only principal if fee is deducted from digital wallet)
      UPDATE wallets
      SET balance = balance + NEW.amount + (CASE WHEN NEW.deduct_fee = 1 THEN 0 ELSE NEW.fee END)
      WHERE channel = 'PHYSICAL_CASH' AND NEW.type = 'CASH_IN' AND NEW.is_debt = 0;

      -- CASH_OUT: digital wallet increases by principal + fee (only principal if fee is deducted from physical cash handed out)
      UPDATE wallets
      SET balance = balance + NEW.amount + (CASE WHEN NEW.deduct_fee = 1 THEN 0 ELSE NEW.fee END)
      WHERE channel = NEW.channel AND NEW.type = 'CASH_OUT' AND NEW.is_debt = 0;

      -- CASH_OUT: cash-on-hand decreases by principal (minus fee if fee is deducted from payout)
      UPDATE wallets
      SET balance = balance - (NEW.amount - (CASE WHEN NEW.deduct_fee = 1 THEN NEW.fee ELSE 0 END))
      WHERE channel = 'PHYSICAL_CASH' AND NEW.type = 'CASH_OUT';

      -- E_LOAD / TV_LOAD: selected float channel decreases by principal
      UPDATE wallets
      SET balance = balance - NEW.amount
      WHERE channel = NEW.channel AND (NEW.type = 'E_LOAD' OR NEW.type = 'TV_LOAD');

      -- E_LOAD / TV_LOAD: cash-on-hand increases by principal + fee (if NOT debt)
      UPDATE wallets
      SET balance = balance + NEW.amount + NEW.fee
      WHERE channel = 'PHYSICAL_CASH' AND (NEW.type = 'E_LOAD' OR NEW.type = 'TV_LOAD') AND NEW.is_debt = 0;

      -- DEBT_PAYMENT: selected channel (where they pay) increases by paid amount
      UPDATE wallets
      SET balance = balance + NEW.amount
      WHERE channel = NEW.channel AND NEW.type = 'DEBT_PAYMENT';
    END;
  `);

  // Create SQLite triggers for transaction deletions (revert changes)
  await db.execAsync(`
    CREATE TRIGGER tr_transaction_delete
    AFTER DELETE ON transactions
    FOR EACH ROW
    BEGIN
      -- CASH_IN: digital wallet increases by principal (minus fee if deducted)
      UPDATE wallets
      SET balance = balance + (OLD.amount - (CASE WHEN OLD.deduct_fee = 1 THEN OLD.fee ELSE 0 END))
      WHERE channel = OLD.channel AND OLD.type = 'CASH_IN';

      -- CASH_IN: cash-on-hand decreases by principal + fee (only principal if fee is deducted from digital wallet)
      UPDATE wallets
      SET balance = balance - (OLD.amount + (CASE WHEN OLD.deduct_fee = 1 THEN 0 ELSE OLD.fee END))
      WHERE channel = 'PHYSICAL_CASH' AND OLD.type = 'CASH_IN' AND OLD.is_debt = 0;

      -- CASH_OUT: digital wallet decreases by principal + fee (only principal if fee is deducted from payout)
      UPDATE wallets
      SET balance = balance - (OLD.amount + (CASE WHEN OLD.deduct_fee = 1 THEN 0 ELSE OLD.fee END))
      WHERE channel = OLD.channel AND OLD.type = 'CASH_OUT' AND OLD.is_debt = 0;

      -- CASH_OUT: cash-on-hand increases by principal (minus fee if fee was deducted from payout)
      UPDATE wallets
      SET balance = balance + (OLD.amount - (CASE WHEN OLD.deduct_fee = 1 THEN OLD.fee ELSE 0 END))
      WHERE channel = 'PHYSICAL_CASH' AND OLD.type = 'CASH_OUT';

      -- E_LOAD / TV_LOAD: selected float channel increases by principal
      UPDATE wallets
      SET balance = balance + OLD.amount
      WHERE channel = OLD.channel AND (OLD.type = 'E_LOAD' OR OLD.type = 'TV_LOAD');

      -- E_LOAD / TV_LOAD: cash-on-hand decreases by principal + fee (if NOT debt)
      UPDATE wallets
      SET balance = balance - (OLD.amount + OLD.fee)
      WHERE channel = 'PHYSICAL_CASH' AND (OLD.type = 'E_LOAD' OR OLD.type = 'TV_LOAD') AND OLD.is_debt = 0;

      -- DEBT_PAYMENT: selected channel (where they paid) decreases by paid amount
      UPDATE wallets
      SET balance = balance - OLD.amount
      WHERE channel = OLD.channel AND OLD.type = 'DEBT_PAYMENT';
    END;
  `);

  // Create SQLite triggers for transaction updates (revert OLD, apply NEW)
  await db.execAsync(`
    DROP TRIGGER IF EXISTS tr_transaction_update;
  `);
  await db.execAsync(`
    CREATE TRIGGER tr_transaction_update
    AFTER UPDATE ON transactions
    FOR EACH ROW
    BEGIN
      -- 1. REVERT OLD TRANSACTION
      -- CASH_IN: digital wallet increases by principal (minus fee if deducted)
      UPDATE wallets
      SET balance = balance + (OLD.amount - (CASE WHEN OLD.deduct_fee = 1 THEN OLD.fee ELSE 0 END))
      WHERE channel = OLD.channel AND OLD.type = 'CASH_IN';

      -- CASH_IN: cash-on-hand decreases by principal + fee (only principal if fee is deducted from digital wallet)
      UPDATE wallets
      SET balance = balance - (OLD.amount + (CASE WHEN OLD.deduct_fee = 1 THEN 0 ELSE OLD.fee END))
      WHERE channel = 'PHYSICAL_CASH' AND OLD.type = 'CASH_IN' AND OLD.is_debt = 0;

      -- CASH_OUT: digital wallet decreases by principal + fee (only principal if fee is deducted from payout)
      UPDATE wallets
      SET balance = balance - (OLD.amount + (CASE WHEN OLD.deduct_fee = 1 THEN 0 ELSE OLD.fee END))
      WHERE channel = OLD.channel AND OLD.type = 'CASH_OUT' AND OLD.is_debt = 0;

      -- CASH_OUT: cash-on-hand increases by principal (minus fee if fee was deducted from payout)
      UPDATE wallets
      SET balance = balance + (OLD.amount - (CASE WHEN OLD.deduct_fee = 1 THEN OLD.fee ELSE 0 END))
      WHERE channel = 'PHYSICAL_CASH' AND OLD.type = 'CASH_OUT';

      -- E_LOAD / TV_LOAD: selected float channel increases by principal
      UPDATE wallets
      SET balance = balance + OLD.amount
      WHERE channel = OLD.channel AND (OLD.type = 'E_LOAD' OR OLD.type = 'TV_LOAD');

      -- E_LOAD / TV_LOAD: cash-on-hand decreases by principal + fee (if NOT debt)
      UPDATE wallets
      SET balance = balance - (OLD.amount + OLD.fee)
      WHERE channel = 'PHYSICAL_CASH' AND (OLD.type = 'E_LOAD' OR OLD.type = 'TV_LOAD') AND OLD.is_debt = 0;

      -- DEBT_PAYMENT: selected channel (where they paid) decreases by paid amount
      UPDATE wallets
      SET balance = balance - OLD.amount
      WHERE channel = OLD.channel AND OLD.type = 'DEBT_PAYMENT';


      -- 2. APPLY NEW TRANSACTION
      -- CASH_IN: digital wallet decreases by principal (minus fee if deducted)
      UPDATE wallets
      SET balance = balance - (NEW.amount - (CASE WHEN NEW.deduct_fee = 1 THEN NEW.fee ELSE 0 END))
      WHERE channel = NEW.channel AND NEW.type = 'CASH_IN';

      -- CASH_IN: cash-on-hand increases by principal + fee (only principal if fee is deducted from digital wallet)
      UPDATE wallets
      SET balance = balance + NEW.amount + (CASE WHEN NEW.deduct_fee = 1 THEN 0 ELSE NEW.fee END)
      WHERE channel = 'PHYSICAL_CASH' AND NEW.type = 'CASH_IN' AND NEW.is_debt = 0;

      -- CASH_OUT: digital wallet increases by principal + fee (only principal if fee is deducted from physical cash handed out)
      UPDATE wallets
      SET balance = balance + NEW.amount + (CASE WHEN NEW.deduct_fee = 1 THEN 0 ELSE NEW.fee END)
      WHERE channel = NEW.channel AND NEW.type = 'CASH_OUT' AND NEW.is_debt = 0;

      -- CASH_OUT: cash-on-hand decreases by principal (minus fee if fee is deducted from payout)
      UPDATE wallets
      SET balance = balance - (NEW.amount - (CASE WHEN NEW.deduct_fee = 1 THEN NEW.fee ELSE 0 END))
      WHERE channel = 'PHYSICAL_CASH' AND NEW.type = 'CASH_OUT';

      -- E_LOAD / TV_LOAD: selected float channel decreases by principal
      UPDATE wallets
      SET balance = balance - NEW.amount
      WHERE channel = NEW.channel AND (NEW.type = 'E_LOAD' OR NEW.type = 'TV_LOAD');

      -- E_LOAD / TV_LOAD: cash-on-hand increases by principal + fee (if NOT debt)
      UPDATE wallets
      SET balance = balance + NEW.amount + NEW.fee
      WHERE channel = 'PHYSICAL_CASH' AND (NEW.type = 'E_LOAD' OR NEW.type = 'TV_LOAD') AND NEW.is_debt = 0;

      -- DEBT_PAYMENT: selected channel (where they pay) increases by paid amount
      UPDATE wallets
      SET balance = balance + NEW.amount
      WHERE channel = NEW.channel AND NEW.type = 'DEBT_PAYMENT';
    END;
  `);

  // Create SQLite triggers for expense insertions
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS tr_expense_insert
    AFTER INSERT ON expenses
    FOR EACH ROW
    BEGIN
      UPDATE wallets
      SET balance = balance - NEW.amount
      WHERE channel = NEW.channel;
    END;
  `);

  // Create SQLite triggers for expense deletions
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS tr_expense_delete
    AFTER DELETE ON expenses
    FOR EACH ROW
    BEGIN
      UPDATE wallets
      SET balance = balance + OLD.amount
      WHERE channel = OLD.channel;
    END;
  `);

  // Guard wallets from going negative
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS tr_wallet_balance_guard
    BEFORE UPDATE ON wallets
    FOR EACH ROW
    WHEN NEW.balance < -0.01
    BEGIN
      SELECT RAISE(ABORT, 'Insufficient float balance in the selected wallet.');
    END;
  `);

  // Seed wallets with default balances if empty
  const wallets = await db.getAllAsync<{ channel: string }>('SELECT channel FROM wallets LIMIT 1');
  if (wallets.length === 0) {
    const channels = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'];
    for (const channel of channels) {
      await db.runAsync('INSERT INTO wallets (channel, balance) VALUES (?, 0.0)', [channel]);
    }
  }

  // Seed settings with default configurations if empty
  const settings = await db.getAllAsync<{ key: string }>('SELECT key FROM settings LIMIT 1');
  if (settings.length === 0) {
    const defaultSettings = [
      { key: 'cash_step_amount', value: '500' },
      { key: 'cash_fee_per_step', value: '10' },
      { key: 'eload_threshold', value: '99' },
      { key: 'eload_fee_low', value: '5' },
      { key: 'eload_fee_high', value: '10' },
      { key: 'tvload_fee', value: '15' }
    ];
    for (const s of defaultSettings) {
      await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    }
  }
}
