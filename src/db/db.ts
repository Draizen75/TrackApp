import * as SQLite from 'expo-sqlite';

type RepairTransactionRow = {
  id: number;
  type: 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD' | 'DEBT_PAYMENT';
  amount: number;
  fee: number;
  customer_id: number | null;
  is_debt: number;
  deduct_fee: number;
  created_at: string;
};

const DEBT_PAYMENT_REPAIR_KEY = 'debt_payment_customer_repair_v1';
const DEBT_PAYMENT_FEE_WALLET_REPAIR_KEY = 'debt_payment_fee_wallet_repair_v1';

function getDebtDelta(tx: RepairTransactionRow) {
  if (tx.is_debt === 1) {
    return (Number(tx.amount) || 0) + (tx.deduct_fee === 1 ? 0 : (Number(tx.fee) || 0));
  }
  if (tx.type === 'DEBT_PAYMENT') {
    return -(Number(tx.amount) || 0);
  }
  return 0;
}

function inferCustomerForPayment(
  balances: Map<number, number>,
  amount: number
) {
  const candidates = Array.from(balances.entries())
    .filter(([, balance]) => balance >= amount - 0.01)
    .map(([customerId]) => customerId);

  return candidates.length === 1 ? candidates[0] : null;
}

async function repairBrokenDebtPayments(db: SQLite.SQLiteDatabase) {
  const alreadyRepaired = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [DEBT_PAYMENT_REPAIR_KEY]
  );

  if (alreadyRepaired?.value === 'done') {
    return;
  }

  const transactions = await db.getAllAsync<RepairTransactionRow>(`
    SELECT id, type, amount, fee, customer_id, is_debt, deduct_fee, created_at
    FROM transactions
    ORDER BY datetime(created_at) ASC, id ASC
  `);

  const runningBalances = new Map<number, number>();
  const repairs: Array<{ id: number; customerId: number }> = [];

  for (const tx of transactions) {
    if (tx.type === 'DEBT_PAYMENT' && tx.customer_id == null) {
      const inferredCustomerId = inferCustomerForPayment(runningBalances, Number(tx.amount) || 0);
      if (inferredCustomerId != null) {
        repairs.push({ id: tx.id, customerId: inferredCustomerId });
        tx.customer_id = inferredCustomerId;
      }
    }

    if (tx.customer_id != null) {
      const nextBalance = (runningBalances.get(tx.customer_id) || 0) + getDebtDelta(tx);
      runningBalances.set(tx.customer_id, nextBalance);
    }
  }

  for (const repair of repairs) {
    await db.runAsync(
      'UPDATE transactions SET customer_id = ? WHERE id = ?',
      [repair.customerId, repair.id]
    );
  }

  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [DEBT_PAYMENT_REPAIR_KEY, 'done']
  );
}

async function repairDebtPaymentFeeWalletCredits(db: SQLite.SQLiteDatabase) {
  const alreadyRepaired = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [DEBT_PAYMENT_FEE_WALLET_REPAIR_KEY]
  );

  if (alreadyRepaired?.value === 'done') {
    return;
  }

  const feeCredits = await db.getAllAsync<{ channel: string; total_fee: number }>(`
    SELECT channel, COALESCE(SUM(fee), 0) AS total_fee
    FROM transactions
    WHERE type = 'DEBT_PAYMENT' AND fee > 0
    GROUP BY channel
  `);

  for (const credit of feeCredits) {
    const totalFee = Number(credit.total_fee) || 0;
    if (totalFee > 0) {
      await db.runAsync(
        'UPDATE wallets SET balance = balance + ? WHERE channel = ?',
        [totalFee, credit.channel]
      );
    }
  }

  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [DEBT_PAYMENT_FEE_WALLET_REPAIR_KEY, 'done']
  );
}

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
      notes TEXT,
      follow_up_status TEXT NOT NULL DEFAULT 'active',
      last_reminded_at TEXT,
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
      category TEXT NOT NULL DEFAULT 'OTHER',
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
  try {
    await db.execAsync("ALTER TABLE customers ADD COLUMN notes TEXT;");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE customers ADD COLUMN follow_up_status TEXT NOT NULL DEFAULT 'active';");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE customers ADD COLUMN last_reminded_at TEXT;");
  } catch {}
  try {
    await db.execAsync("ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'OTHER';");
  } catch {}

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

      -- DEBT_PAYMENT: selected channel increases by principal paid plus extra profit received
      UPDATE wallets
      SET balance = balance + NEW.amount + NEW.fee
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

      -- DEBT_PAYMENT: selected channel decreases by principal paid plus extra profit received
      UPDATE wallets
      SET balance = balance - OLD.amount - OLD.fee
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

      -- DEBT_PAYMENT: selected channel decreases by principal paid plus extra profit received
      UPDATE wallets
      SET balance = balance - OLD.amount - OLD.fee
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

      -- DEBT_PAYMENT: selected channel increases by principal paid plus extra profit received
      UPDATE wallets
      SET balance = balance + NEW.amount + NEW.fee
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

  await repairDebtPaymentFeeWalletCredits(db);
  await repairBrokenDebtPayments(db);
}
