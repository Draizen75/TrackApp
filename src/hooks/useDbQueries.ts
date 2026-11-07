import { migrateDbIfNeeded } from '@/db/db';
import { buildTargetedDebtPaymentRecords } from '@/utils/debt-payment-batch';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type MutationFunctionContext,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef } from 'react';

export function cleanErrorMessage(error: any): string {
  if (!error) return 'An unknown error occurred';
  const msg = error.message || String(error);
  if (msg.includes('Insufficient float balance')) {
    return 'Insufficient float balance in the selected wallet.';
  }
  if (msg.includes('caused by:')) {
    const parts = msg.split('caused by:');
    let cause = parts[parts.length - 1].trim();
    cause = cause.replace(/error code \d+:/gi, '').trim();
    cause = cause.replace(/error code:/gi, '').trim();
    if (cause.includes('Insufficient float balance')) {
      return 'Insufficient float balance in the selected wallet.';
    }
    return cause.charAt(0).toUpperCase() + cause.slice(1);
  }
  return msg;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  notes?: string | null;
  follow_up_status?: string | null;
  last_reminded_at?: string | null;
  created_at: string;
}

export interface Transaction {
  id: number;
  type: 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD' | 'DEBT_PAYMENT';
  amount: number;
  fee: number;
  channel: string;
  customer_id: number | null;
  customer_name?: string | null;
  is_debt: number;
  deduct_fee: number;
  target_debt_id?: number | null;
  created_at: string;
}

export function sortTransactionsNewestFirst(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id
  );
}

export type TransactionHistoryFilters = {
  type?: Transaction['type'] | 'ALL';
  search?: string;
  channel?: string | 'ALL';
  startDate?: string;
  endDate?: string;
};

type TransactionHistoryCursor = { createdAt: string; id: number; index?: number; indexKey?: string };
type TransactionHistoryPage = {
  transactions: Transaction[];
  total: number;
  nextCursor?: TransactionHistoryCursor;
};

const HISTORY_PAGE_SIZE = 50;
type TransactionHistoryIndex = { filterKey: string; customerNamesById: Map<number, string>; transactions: Transaction[] };
let transactionHistoryIndexes = new WeakMap<Transaction[], TransactionHistoryIndex>();
let webCustomerNamesByCustomers = new WeakMap<any[], Map<number, string>>();

const getWebCustomerNamesById = (customers: any[]) => {
  let namesById = webCustomerNamesByCustomers.get(customers);
  if (!namesById) {
    namesById = new Map<number, string>(customers.map(customer => [
      Number(customer.id),
      String(customer.name || ''),
    ]));
    webCustomerNamesByCustomers.set(customers, namesById);
  }
  return namesById;
};

export function paginateTransactionHistory(
  transactions: Transaction[],
  customerNamesById: Map<number, string>,
  filters: TransactionHistoryFilters,
  cursor: TransactionHistoryCursor | null,
  pageSize = HISTORY_PAGE_SIZE,
): TransactionHistoryPage {
  const type = filters.type && filters.type !== 'ALL' ? filters.type : null;
  const search = filters.search?.trim().toLowerCase() || '';
  const channel = filters.channel && filters.channel !== 'ALL' ? filters.channel : null;
  const startDate = filters.startDate || null;
  const endDate = filters.endDate || null;
  const indexKey = JSON.stringify([type, search, channel, startDate, endDate]);
  let index = transactionHistoryIndexes.get(transactions);
  if (!index || index.filterKey !== indexKey || index.customerNamesById !== customerNamesById) {
    const matching: Transaction[] = [];
    for (const transaction of transactions) {
      if (type && transaction.type !== type) continue;
      if (channel && transaction.channel !== channel) continue;
      const transactionTime = new Date(transaction.created_at).getTime();
      if (startDate && transactionTime < new Date(startDate).getTime()) continue;
      if (endDate && transactionTime >= new Date(endDate).getTime()) continue;
      const customerName = transaction.customer_id == null ? null : customerNamesById.get(transaction.customer_id) || null;
      if (search &&
        !(customerName || 'anonymous transaction').toLowerCase().includes(search) &&
        !(transaction.channel || '').toLowerCase().includes(search) &&
        !String(transaction.amount ?? '').includes(search)) {
        continue;
      }
      matching.push({ ...transaction, customer_name: customerName });
    }
    matching.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id);
    index = { filterKey: indexKey, customerNamesById, transactions: matching };
    transactionHistoryIndexes.set(transactions, index);
  }

  const cachedCursorRow = cursor?.index == null ? undefined : index.transactions[cursor.index - 1];
  const cachedStart = cursor?.indexKey === indexKey &&
    cachedCursorRow?.created_at === cursor.createdAt &&
    cachedCursorRow.id === cursor.id
    ? cursor.index
    : undefined;
  const start = cachedStart ?? (cursor
    ? index.transactions.findIndex(tx => tx.created_at < cursor.createdAt ||
      (tx.created_at === cursor.createdAt && tx.id < cursor.id))
    : 0);
  const pageStart = Math.max(0, start < 0 ? index.transactions.length : start);
  const pageWithLookahead = index.transactions.slice(pageStart, pageStart + pageSize + 1);
  const page = pageWithLookahead.slice(0, pageSize);
  const last = page.at(-1);
  return {
    transactions: page,
    total: index.transactions.length,
    nextCursor: pageWithLookahead.length > pageSize && last
      ? { createdAt: last.created_at, id: last.id, index: pageStart + page.length, indexKey }
      : undefined,
  };
}

export interface Wallet {
  channel: string;
  balance: number;
}

export interface Debtor {
  id: number;
  name: string;
  phone: string | null;
  notes?: string | null;
  follow_up_status?: string | null;
  last_reminded_at?: string | null;
  balance: number;
  oldest_debt_date: string | null;
  last_payment_date?: string | null;
  latest_tx_date?: string | null;
}

export const getDebtorBalanceStatus = (balance: number): 'active' | 'credit' | 'settled' => {
  if (roundCurrency(balance) > 0) return 'active';
  if (roundCurrency(balance) < 0) return 'credit';
  return 'settled';
};

export function applyOptimisticDebtPayment(
  debtors: Debtor[] | undefined,
  customerId: number,
  amount: number,
  paidAt: string,
): Debtor[] | undefined {
  if (!debtors || amount <= 0) return debtors;

  return debtors.map((debtor) => {
    if (debtor.id !== customerId) return debtor;
    const balance = roundCurrency(debtor.balance - amount);
    return {
      ...debtor,
      balance,
      oldest_debt_date: roundCurrency(balance) <= 0 ? null : debtor.oldest_debt_date,
      last_payment_date: paidAt,
      latest_tx_date: paidAt,
    };
  });
}

function applyOptimisticPaymentToLedgerSnapshot(
  snapshot: DebtLedgerSnapshot | undefined,
  customerId: number,
  amount: number,
  paidAt: string,
) {
  if (!snapshot) return snapshot;
  const debtors = applyOptimisticDebtPayment(snapshot.debtors, customerId, amount, paidAt);
  return debtors ? { ...snapshot, debtors } : snapshot;
}

export interface HealthCheckItem {
  kind: 'low_float' | 'overdue_debt' | 'orphan_payment' | 'negative_debt';
  label: string;
  detail: string;
  severity: 'info' | 'warning' | 'danger';
}

export interface DailyProfitItem {
  dateKey: string;
  date: string;
  profit: number; // Legacy alias for earnings collected.
  grossProfit: number; // Fees recorded, including fees on unpaid debts.
  netProfit: number; // Earnings collected, excluding unpaid debt fees.
  pendingEarnings: number; // Remaining unpaid debt fees from debts created on this date.
  txCount: number;
}

export interface EarningsTimeframeSummary {
  grossProfit: number;
  netProfit: number;
  txCount: number;
}

export interface EarningsSummary {
  today: EarningsTimeframeSummary;
  week: EarningsTimeframeSummary;
  month: EarningsTimeframeSummary;
}

// ─── Export data shape (unified across web & native) ────────────────────────

export interface ExportData {
  transactions: (Transaction & { customer_name?: string | null })[];
  debtors: Debtor[];
}

export interface BackupData {
  schema: 'trackapp.backup';
  version: 1;
  exported_at: string;
  customers: Customer[];
  transactions: Transaction[];
  wallets: Wallet[];
  settings: Record<string, string>;
}

const transactionTypes = new Set<Transaction['type']>(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD', 'DEBT_PAYMENT']);
const requiredWalletChannels = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'];

export const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const exceedsCurrencyAmount = (amount: number, limit: number) => roundCurrency(amount) > roundCurrency(limit);
const hasPositiveCurrency = (value: number) => roundCurrency(value) > 0;
const hasNegativeCurrency = (value: number) => roundCurrency(value) < 0;
const hasNonZeroCurrency = (value: number) => roundCurrency(value) !== 0;

export function splitSettlementReceived(received: number, principalCap: number) {
  const safeReceived = Math.max(0, received);
  const safePrincipalCap = Math.max(0, principalCap);
  return {
    principal: Math.min(safeReceived, safePrincipalCap),
    suggestedProfit: Math.max(0, safeReceived - safePrincipalCap),
  };
}

export function isSettlementBreakdownBalanced(
  received: number,
  principal: number,
  profit: number,
) {
  const safeReceived = roundCurrency(received);
  const safePrincipal = roundCurrency(principal);
  const safeProfit = roundCurrency(profit);
  if (![safeReceived, safePrincipal, safeProfit].every(Number.isFinite)) return false;
  if (safeReceived < 0 || safePrincipal < 0 || safeProfit < 0) return false;
  // A zero-received entry is the existing profit/interest-only workflow.
  if (safeReceived === 0) return safePrincipal === 0;
  // All values are normalized to cents above, so even a one-cent mismatch
  // must be rejected to keep wallet credits and ledger breakdowns identical.
  return safeReceived === roundCurrency(safePrincipal + safeProfit);
}

export function assertValidTransactionInput(tx: {
  type: Transaction['type']; amount: number; fee: number; channel: string;
  customer_id: number | null; is_debt: boolean; deduct_fee?: boolean;
}, options: { allowOrphanDebtPayment?: boolean; allowHistoricalCreditWithoutCustomer?: boolean } = {}) {
  if (!transactionTypes.has(tx.type) || !Number.isFinite(tx.amount) || !Number.isFinite(tx.fee)) {
    throw new Error('Transaction contains an invalid type or amount.');
  }
  if (tx.amount < 0 || tx.fee < 0 || !tx.channel.trim()) {
    throw new Error('Transaction amount and fee must be non-negative and a wallet is required.');
  }
  if (tx.deduct_fee && tx.fee > tx.amount + 0.001) {
    throw new Error('A deducted fee cannot be greater than the transaction amount.');
  }
  if (tx.is_debt && !tx.customer_id && !options.allowHistoricalCreditWithoutCustomer) {
    throw new Error('Debtor name is required for credit transactions.');
  }
  if (tx.type === 'DEBT_PAYMENT') {
    if (tx.is_debt) {
      throw new Error('Debt payments cannot be recorded as a new debt.');
    }
    if ((!options.allowOrphanDebtPayment && !tx.customer_id) || (tx.amount === 0 && tx.fee <= 0)) {
      throw new Error('Debt payment must include a linked debtor and a principal payment or extra profit/interest.');
    }
  } else if (tx.amount <= 0) {
    throw new Error('Transaction amount must be greater than 0.');
  }
}

function getNextWebId(items: { id: number }[]) {
  return items.reduce((highest, item) => Math.max(highest, Number(item.id) || 0), 0) + 1;
}

export function assertValidBackup(backup: BackupData) {
  if (!backup || typeof backup !== 'object' || backup.schema !== 'trackapp.backup' || backup.version !== 1 ||
    !Array.isArray(backup.customers) || !Array.isArray(backup.transactions) || !Array.isArray(backup.wallets) ||
    !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) {
    throw new Error('Backup file is missing required ledger data.');
  }
  if (!backup.exported_at || !Number.isFinite(new Date(backup.exported_at).getTime())) {
    throw new Error('Backup contains an invalid export date.');
  }
  const customerIds = new Set<number>();
  for (const customer of backup.customers) {
    if (!Number.isSafeInteger(customer.id) || customer.id <= 0 || !String(customer.name || '').trim() || customerIds.has(customer.id)) {
      throw new Error('Backup contains an invalid or duplicate customer record.');
    }
    customerIds.add(customer.id);
  }
  const walletChannels = new Set<string>();
  for (const wallet of backup.wallets) {
    const channel = String(wallet.channel || '').trim();
    if (!channel || walletChannels.has(channel) || !Number.isFinite(Number(wallet.balance)) || Number(wallet.balance) < 0) {
      throw new Error('Backup contains an invalid or duplicate wallet record.');
    }
    walletChannels.add(channel);
  }
  if (requiredWalletChannels.some((channel) => !walletChannels.has(channel))) {
    throw new Error('Backup is missing one or more required wallets.');
  }
  const transactionIds = new Set<number>();
  for (const tx of backup.transactions) {
    if (!Number.isSafeInteger(tx.id) || tx.id <= 0 || transactionIds.has(tx.id) ||
      !walletChannels.has(String(tx.channel || '').trim()) ||
      (tx.customer_id != null && !customerIds.has(Number(tx.customer_id))) ||
      (tx.target_debt_id != null && (!Number.isSafeInteger(tx.target_debt_id) || tx.target_debt_id <= 0))) {
      throw new Error('Backup contains an invalid transaction reference.');
    }
    if (tx.is_debt !== 0 && tx.is_debt !== 1 && typeof tx.is_debt !== 'boolean') {
      throw new Error('Backup contains an invalid transaction flag.');
    }
    if (tx.deduct_fee !== 0 && tx.deduct_fee !== 1 && typeof tx.deduct_fee !== 'boolean') {
      throw new Error('Backup contains an invalid transaction flag.');
    }
    assertValidTransactionInput({
      type: tx.type, amount: Number(tx.amount), fee: Number(tx.fee), channel: String(tx.channel || ''),
      customer_id: tx.customer_id == null ? null : Number(tx.customer_id), is_debt: Number(tx.is_debt) === 1,
      deduct_fee: Number(tx.deduct_fee) === 1,
    }, { allowHistoricalCreditWithoutCustomer: true, allowOrphanDebtPayment: true });
    transactionIds.add(tx.id);
  }
  const balances = new Map<number, number>();
  const transactionsByCustomer = new Map<number, Transaction[]>();
  for (const tx of [...backup.transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
  )) {
    const timestamp = new Date(tx.created_at).getTime();
    if (!Number.isFinite(timestamp)) throw new Error('Backup contains an invalid transaction date.');
    const customerId = tx.customer_id == null ? null : Number(tx.customer_id);
    const customerTransactions = customerId == null ? [] : (transactionsByCustomer.get(customerId) || []);
    if (Number(tx.is_debt) === 1 && customerId != null) {
      const debt = Number(tx.amount) + (Number(tx.deduct_fee) === 1 ? 0 : Number(tx.fee));
      balances.set(customerId, (balances.get(customerId) || 0) + debt);
    } else if (tx.type === 'DEBT_PAYMENT' && customerId != null) {
      if (tx.target_debt_id != null && !customerTransactions.some(debt => debt.id === tx.target_debt_id && debt.is_debt === 1)) {
        throw new Error('Backup contains an invalid transaction reference.');
      }
      const outstanding = tx.target_debt_id == null
        ? balances.get(customerId) || 0
        : getDebtEntryOutstanding(customerTransactions, tx.target_debt_id);
      if (exceedsCurrencyAmount(Number(tx.amount), outstanding)) {
        throw new Error('Backup contains a debt payment that exceeds the outstanding balance.');
      }
      const totalOutstanding = balances.get(customerId) || 0;
      balances.set(customerId, totalOutstanding - Number(tx.amount));
    }
    if (customerId != null) {
      transactionsByCustomer.set(customerId, [...customerTransactions, tx]);
    }
  }
}

/**
 * Calculates the date of the oldest UNPAID debt for a customer using FIFO (First-In, First-Out).
 * 
 * When a customer makes payments, payments settle debts in chronological order.
 * If total payments cover all prior debts and a new debt is added later, the overdue date
 * correctly points to the earliest debt transaction that remains partially or fully unpaid.
 */
export function calculateOldestUnpaidDebtDate(customerTransactions: Transaction[]): string | null {
  if (!customerTransactions || customerTransactions.length === 0) return null;
  const sorted = [...customerTransactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
  );
  const debts: { id: number; created_at: string; outstanding: number }[] = [];
  const debtById = new Map<number, { id: number; created_at: string; outstanding: number }>();
  let fifoIndex = 0;

  for (const transaction of sorted) {
    if (transaction.is_debt === 1) {
      const debt = {
        id: transaction.id,
        created_at: transaction.created_at,
        outstanding: (Number(transaction.amount) || 0) +
          (transaction.deduct_fee === 1 ? 0 : (Number(transaction.fee) || 0)),
      };
      debts.push(debt);
      debtById.set(debt.id, debt);
      continue;
    }
    if (transaction.type !== 'DEBT_PAYMENT') continue;

    let remainingPayment = Number(transaction.amount) || 0;
    if (transaction.target_debt_id != null) {
      const target = debtById.get(transaction.target_debt_id);
      if (target) target.outstanding = Math.max(0, target.outstanding - remainingPayment);
      continue;
    }

    while (remainingPayment > 0 && fifoIndex < debts.length) {
      const debt = debts[fifoIndex];
      const applied = Math.min(remainingPayment, debt.outstanding);
      debt.outstanding -= applied;
      remainingPayment -= applied;
      if (debt.outstanding <= 0) fifoIndex += 1;
    }
  }

  return debts.find(debt => debt.outstanding > 0.001)?.created_at || null;
}

export interface DebtPaymentAllocation {
  principalPaid: number;
  contractualEarningsPaid: number;
  extraProfitPaid: number;
  pendingPrincipal: number;
  pendingEarnings: number;
}

interface DebtLedgerSnapshot {
  debtors: Debtor[];
  allocation: DebtPaymentAllocation;
  analysis: DebtLedgerAnalysis;
}

const selectDebtLedgerDebtors = (snapshot: DebtLedgerSnapshot) => snapshot.debtors;
const selectDebtLedgerAllocation = (snapshot: DebtLedgerSnapshot) => snapshot.allocation;

export interface DebtCustomerLedgerSummary {
  balance: number;
  lastPaymentDate: string | null;
  latestTransactionDate: string;
  oldestUnpaidDebtDate: string | null;
}

export interface DebtLedgerAnalysis {
  allocation: DebtPaymentAllocation;
  collectedEarningsByDate: Map<string, number>;
  pendingEarningsByDate: Map<string, number>;
  customers: Map<number, DebtCustomerLedgerSummary>;
}

export function analyzeDebtLedger(transactions: Transaction[]): DebtLedgerAnalysis {
  type OutstandingDebt = {
    id: number;
    createdAt: string;
    principal: number;
    earnings: number;
  };
  type CustomerState = {
    balance: number;
    lastPaymentDate: string | null;
    latestTransactionDate: string;
    debts: OutstandingDebt[];
    debtById: Map<number, OutstandingDebt>;
    fifoIndex: number;
  };

  const allocation: DebtPaymentAllocation = {
    principalPaid: 0,
    contractualEarningsPaid: 0,
    extraProfitPaid: 0,
    pendingPrincipal: 0,
    pendingEarnings: 0,
  };
  const collectedEarningsByDate = new Map<string, number>();
  const pendingEarningsByDate = new Map<string, number>();
  const addPendingEarnings = (createdAt: string, amount: number) => {
    if (amount <= 0) return;
    const dateKey = extractStoredDateKey(createdAt);
    pendingEarningsByDate.set(dateKey, (pendingEarningsByDate.get(dateKey) || 0) + amount);
  };
  const states = new Map<number, CustomerState>();
  const addCollectedEarnings = (createdAt: string, amount: number) => {
    const dateKey = extractStoredDateKey(createdAt);
    collectedEarningsByDate.set(dateKey, (collectedEarningsByDate.get(dateKey) || 0) + amount);
  };
  let isChronological = true;
  for (let index = 1; index < transactions.length; index += 1) {
    const previous = transactions[index - 1];
    const current = transactions[index];
    const previousTime = new Date(previous.created_at).getTime();
    const currentTime = new Date(current.created_at).getTime();
    if (previousTime > currentTime || (previousTime === currentTime && previous.id > current.id)) {
      isChronological = false;
      break;
    }
  }
  const sorted = isChronological
    ? transactions
    : [...transactions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
    );

  for (const transaction of sorted) {
    if (transaction.is_debt !== 1 && transaction.type !== 'DEBT_PAYMENT') continue;

    const principal = Number(transaction.amount) || 0;
    const earnings = transaction.deduct_fee === 1 ? 0 : Number(transaction.fee) || 0;
    if (transaction.customer_id == null) {
      if (transaction.is_debt === 1) {
        allocation.pendingPrincipal += principal;
        allocation.pendingEarnings += earnings;
        addPendingEarnings(transaction.created_at, earnings);
      } else {
        const extraProfit = Number(transaction.fee) || 0;
        allocation.extraProfitPaid += extraProfit;
        addCollectedEarnings(transaction.created_at, extraProfit);
      }
      continue;
    }

    let state = states.get(transaction.customer_id);
    if (!state) {
      state = {
        balance: 0,
        lastPaymentDate: null,
        latestTransactionDate: transaction.created_at,
        debts: [],
        debtById: new Map<number, OutstandingDebt>(),
        fifoIndex: 0,
      };
      states.set(transaction.customer_id, state);
    }
    state.latestTransactionDate = transaction.created_at;

    if (transaction.is_debt === 1) {
      const debt = {
        id: transaction.id,
        createdAt: transaction.created_at,
        principal,
        earnings,
      };
      state.debts.push(debt);
      state.debtById.set(debt.id, debt);
      state.balance += principal + earnings;
      continue;
    }

    const extraProfit = Number(transaction.fee) || 0;
    allocation.extraProfitPaid += extraProfit;
    addCollectedEarnings(transaction.created_at, extraProfit);
    state.balance -= principal;
    state.lastPaymentDate = transaction.created_at;

    let remainingPayment = principal;
    let contractualEarningsPaid = 0;
    let principalPaid = 0;
    const applyPayment = (debt: OutstandingDebt) => {
      const earningsApplied = Math.min(remainingPayment, debt.earnings);
      debt.earnings -= earningsApplied;
      remainingPayment -= earningsApplied;

      const principalApplied = Math.min(remainingPayment, debt.principal);
      debt.principal -= principalApplied;
      remainingPayment -= principalApplied;
      return remainingPayment;
    };
    const applyDebtPayment = (debt: OutstandingDebt) => {
      const beforePrincipal = debt.principal;
      const beforeEarnings = debt.earnings;
      const afterPayment = applyPayment(debt);
      principalPaid += beforePrincipal - debt.principal;
      contractualEarningsPaid += beforeEarnings - debt.earnings;
      return afterPayment;
    };

    if (transaction.target_debt_id != null) {
      const debt = state.debtById.get(transaction.target_debt_id);
      if (debt) remainingPayment = applyDebtPayment(debt);
    } else {
      while (remainingPayment > 0 && state.fifoIndex < state.debts.length) {
        const debt = state.debts[state.fifoIndex];
        remainingPayment = applyDebtPayment(debt);
        if (debt.principal <= 0 && debt.earnings <= 0) state.fifoIndex += 1;
      }
    }

    allocation.contractualEarningsPaid += contractualEarningsPaid;
    allocation.principalPaid += principalPaid;
    addCollectedEarnings(transaction.created_at, contractualEarningsPaid);
  }

  const customers = new Map<number, DebtCustomerLedgerSummary>();
  for (const [customerId, state] of states) {
    for (const debt of state.debts) {
      allocation.pendingPrincipal += debt.principal;
      allocation.pendingEarnings += debt.earnings;
      addPendingEarnings(debt.createdAt, debt.earnings);
    }
    customers.set(customerId, {
      balance: state.balance,
      lastPaymentDate: state.lastPaymentDate,
      latestTransactionDate: state.latestTransactionDate,
      oldestUnpaidDebtDate: state.debts.find(debt => debt.principal + debt.earnings > 0.001)?.createdAt || null,
    });
  }

  return { allocation, collectedEarningsByDate, pendingEarningsByDate, customers };
}

/**
 * Applies debt payments FIFO: contractual earnings first, then principal.
 * Payment fees are separately tracked as extra collected profit and never reduce debt.
 */
export function calculateDebtPaymentAllocation(customerTransactions: Transaction[]): DebtPaymentAllocation {
  const result: DebtPaymentAllocation = {
    principalPaid: 0,
    contractualEarningsPaid: 0,
    extraProfitPaid: 0,
    pendingPrincipal: 0,
    pendingEarnings: 0,
  };
  const debts: { id: number; principal: number; earnings: number }[] = [];
  const sorted = [...customerTransactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
  );
  const debtById = new Map<number, (typeof debts)[number]>();
  let fifoIndex = 0;

  const allocatePayment = (debt: (typeof debts)[number], remainingPayment: number) => {
    const earningsApplied = Math.min(remainingPayment, debt.earnings);
    debt.earnings -= earningsApplied;
    remainingPayment -= earningsApplied;
    result.contractualEarningsPaid += earningsApplied;

    const principalApplied = Math.min(remainingPayment, debt.principal);
    debt.principal -= principalApplied;
    remainingPayment -= principalApplied;
    result.principalPaid += principalApplied;
    return remainingPayment;
  };

  for (const transaction of sorted) {
    if (transaction.is_debt === 1) {
      const debt = {
        id: transaction.id,
        principal: Number(transaction.amount) || 0,
        earnings: transaction.deduct_fee === 1 ? 0 : (Number(transaction.fee) || 0),
      };
      debts.push(debt);
      debtById.set(debt.id, debt);
      continue;
    }
    if (transaction.type !== 'DEBT_PAYMENT') continue;

    result.extraProfitPaid += Number(transaction.fee) || 0;
    let remainingPayment = Number(transaction.amount) || 0;
    if (transaction.target_debt_id != null) {
      const target = debtById.get(transaction.target_debt_id);
      if (target) allocatePayment(target, remainingPayment);
      continue;
    }

    while (remainingPayment > 0 && fifoIndex < debts.length) {
      const debt = debts[fifoIndex];
      remainingPayment = allocatePayment(debt, remainingPayment);
      if (debt.principal <= 0 && debt.earnings <= 0) fifoIndex += 1;
    }
  }

  for (const debt of debts) {
    result.pendingPrincipal += debt.principal;
    result.pendingEarnings += debt.earnings;
  }
  return result;
}

/** Remaining amount owed by a selected debt entry, including its fee when applicable. */
export function getDebtOutstandingById(customerTransactions: Transaction[]) {
  const debts: { id: number; principal: number; earnings: number }[] = [];
  const sorted = [...customerTransactions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id);
  const debtById = new Map<number, (typeof debts)[number]>();
  let fifoIndex = 0;
  const applyPayment = (debt: (typeof debts)[number], amount: number) => {
    let remaining = amount;
    const earnings = Math.min(remaining, debt.earnings);
    debt.earnings -= earnings;
    remaining -= earnings;
    const principal = Math.min(remaining, debt.principal);
    debt.principal -= principal;
    return remaining - principal;
  };

  for (const tx of sorted) {
    if (tx.is_debt === 1) {
      const debt = { id: tx.id, principal: Number(tx.amount) || 0, earnings: tx.deduct_fee === 1 ? 0 : (Number(tx.fee) || 0) };
      debts.push(debt);
      debtById.set(debt.id, debt);
      continue;
    }
    if (tx.type !== 'DEBT_PAYMENT') continue;
    let remaining = Number(tx.amount) || 0;
    if (tx.target_debt_id != null) {
      const target = debtById.get(tx.target_debt_id);
      if (target) applyPayment(target, remaining);
      continue;
    }
    while (remaining > 0 && fifoIndex < debts.length) {
      const debt = debts[fifoIndex];
      remaining = applyPayment(debt, remaining);
      if (debt.principal <= 0 && debt.earnings <= 0) fifoIndex += 1;
    }
  }
  return new Map(debts.map(debt => [debt.id, Math.max(0, debt.principal + debt.earnings)]));
}

export function getDebtEntryOutstanding(customerTransactions: Transaction[], debtId: number) {
  return getDebtOutstandingById(customerTransactions).get(debtId) || 0;
}

/**
 * Aggregates FIFO debt allocations without letting one customer's payment settle another customer's debt.
 * Unlinked historical credit is kept fully pending because it cannot be safely matched to a payment.
 */
export function calculateLedgerDebtAllocation(transactions: Transaction[]): DebtPaymentAllocation {
  const result: DebtPaymentAllocation = {
    principalPaid: 0,
    contractualEarningsPaid: 0,
    extraProfitPaid: 0,
    pendingPrincipal: 0,
    pendingEarnings: 0,
  };
  const transactionsByCustomer = new Map<number, Transaction[]>();

  for (const transaction of transactions) {
    if (transaction.is_debt !== 1 && transaction.type !== 'DEBT_PAYMENT') continue;

    if (transaction.customer_id == null) {
      if (transaction.is_debt === 1) {
        result.pendingPrincipal += Number(transaction.amount) || 0;
        result.pendingEarnings += transaction.deduct_fee === 1 ? 0 : (Number(transaction.fee) || 0);
      } else {
        result.extraProfitPaid += Number(transaction.fee) || 0;
      }
      continue;
    }

    const customerTransactions = transactionsByCustomer.get(transaction.customer_id) || [];
    customerTransactions.push(transaction);
    transactionsByCustomer.set(transaction.customer_id, customerTransactions);
  }

  for (const customerTransactions of transactionsByCustomer.values()) {
    const allocation = calculateDebtPaymentAllocation(customerTransactions);
    result.principalPaid += allocation.principalPaid;
    result.contractualEarningsPaid += allocation.contractualEarningsPaid;
    result.extraProfitPaid += allocation.extraProfitPaid;
    result.pendingPrincipal += allocation.pendingPrincipal;
    result.pendingEarnings += allocation.pendingEarnings;
  }

  return result;
}

// ─── WEB MOCK DATABASE ENGINE (localStorage backed for offline preview support) ───

const channelNames: Record<string, string> = {
  GCASH: 'GCash',
  MAYA: 'Maya',
  MAYA_BUSINESS: 'Maya Biz',
  MARIBANK: 'MariBank',
  PHYSICAL_CASH: 'Cash Box',
};

const defaultWebDb = {
  customers: [
    { id: 1, name: 'Sari-Sari Store Cash', phone: '', notes: '', follow_up_status: 'active', last_reminded_at: null, created_at: new Date().toISOString() }
  ],
  transactions: [] as any[],
  wallets: {
    GCASH: 0,
    MAYA: 0,
    MAYA_BUSINESS: 0,
    MARIBANK: 0,
    PHYSICAL_CASH: 0,
  } as Record<string, number>,
  settings: {
    cash_step_amount: '500',
    cash_fee_per_step: '10',
    eload_threshold: '99',
    eload_fee_low: '5',
    eload_fee_high: '10',
    tvload_fee: '15'
  } as Record<string, string>
};

let cachedWebDbRaw: string | null = null;
let cachedWebDb: any = null;
let cachedWebDbInIndexedDb = false;
let webDbStorageDatabase: Promise<IDBDatabase> | null = null;
let webDbChangeChannel: BroadcastChannel | null = null;

const WEB_DB_STORAGE_NAME = 'trackapp-web-ledger';
const WEB_DB_STORAGE_STORE = 'state';
const WEB_DB_STORAGE_KEY = 'counter_db';
const WEB_DB_STORAGE_VERSION_KEY = 'counter_db_storage_version';
const WEB_DB_STORAGE_VERSION = 'indexeddb_v1';
const WEB_DB_MUTATION_LOCK = 'trackapp-web-ledger-mutation';

const clearWebDbCache = () => {
  cachedWebDbRaw = null;
  cachedWebDb = null;
  cachedWebDbInIndexedDb = false;
  transactionHistoryIndexes = new WeakMap();
  webCustomerNamesByCustomers = new WeakMap();
};

const withWebDbMutationLock = async <T>(mutation: () => Promise<T>) => {
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!lockManager) {
    throw new Error('Ledger changes are unavailable because this browser cannot safely coordinate writes across tabs.');
  }

  return lockManager.request(WEB_DB_MUTATION_LOCK, async () => {
    clearWebDbCache();
    await loadWebDb();
    return mutation();
  });
};

const getWebDbStorageDatabase = () => {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  if (!webDbStorageDatabase) {
    webDbStorageDatabase = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(WEB_DB_STORAGE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(WEB_DB_STORAGE_STORE)) {
          database.createObjectStore(WEB_DB_STORAGE_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          webDbStorageDatabase = null;
          clearWebDbCache();
        };
        resolve(database);
      };
      request.onerror = () => {
        webDbStorageDatabase = null;
        reject(request.error || new Error('Unable to open web ledger storage.'));
      };
      request.onblocked = () => {
        webDbStorageDatabase = null;
        reject(new Error('Web ledger storage is blocked by another open connection.'));
      };
    });
  }
  return webDbStorageDatabase;
};

const getWebDbStorageValue = async (database: IDBDatabase, key: string) => new Promise<any>((resolve, reject) => {
  const request = database.transaction(WEB_DB_STORAGE_STORE, 'readonly')
    .objectStore(WEB_DB_STORAGE_STORE)
    .get(key);
  request.onsuccess = () => resolve(request.result?.value ?? null);
  request.onerror = () => reject(request.error || new Error('Unable to read web ledger storage.'));
});

const setWebDbStorageValues = async (database: IDBDatabase, values: { key: string; value: any }[]) => new Promise<void>((resolve, reject) => {
  const transaction = database.transaction(WEB_DB_STORAGE_STORE, 'readwrite');
  const store = transaction.objectStore(WEB_DB_STORAGE_STORE);
  for (const entry of values) {
    store.put(entry);
  }
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Unable to save web ledger storage.'));
  transaction.onabort = () => reject(transaction.error || new Error('Web ledger storage save was aborted.'));
});

const DEBT_PAYMENT_REPAIR_KEY = 'debt_payment_customer_repair_v1';

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const extractStoredDateKey = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return getLocalDateKey(parsed);
};

type DashboardTransactionAggregate = {
  daily: Map<string, { grossProfit: number; immediateEarnings: number; txCount: number }>;
  grossProfit: number;
  immediateEarnings: number;
  todayTransactionsCount: number;
  debtAddedToday: number;
  debtCollectedToday: number;
  orphanPayments: number;
};

function aggregateDashboardTransactions(
  transactions: Transaction[],
  todayDateKey: string,
): DashboardTransactionAggregate {
  const daily = new Map<string, { grossProfit: number; immediateEarnings: number; txCount: number }>();
  const aggregate: DashboardTransactionAggregate = {
    daily,
    grossProfit: 0,
    immediateEarnings: 0,
    todayTransactionsCount: 0,
    debtAddedToday: 0,
    debtCollectedToday: 0,
    orphanPayments: 0,
  };

  for (const tx of transactions) {
    const fee = Number(tx.fee) || 0;
    const amount = Number(tx.amount) || 0;
    const dateKey = extractStoredDateKey(tx.created_at);
    const isImmediateEarning = tx.is_debt !== 1 && tx.type !== 'DEBT_PAYMENT';
    const day = daily.get(dateKey) || { grossProfit: 0, immediateEarnings: 0, txCount: 0 };

    aggregate.grossProfit += fee;
    day.grossProfit += fee;
    day.txCount += 1;
    if (isImmediateEarning) {
      aggregate.immediateEarnings += fee;
      day.immediateEarnings += fee;
    }
    if (dateKey === todayDateKey) {
      aggregate.todayTransactionsCount += 1;
      if (tx.is_debt === 1) {
        aggregate.debtAddedToday += amount + (tx.deduct_fee === 1 ? 0 : fee);
      }
      if (tx.type === 'DEBT_PAYMENT') aggregate.debtCollectedToday += amount;
    }
    if (tx.type === 'DEBT_PAYMENT' && tx.customer_id == null) aggregate.orphanPayments += 1;

    daily.set(dateKey, day);
  }

  return aggregate;
}

export function calculateCollectedDebtEarningsByDate(transactions: Transaction[]) {
  type OutstandingDebt = { id: number; principal: number; earnings: number };
  const transactionsByDate = new Map<string, number>();
  const debtsByCustomer = new Map<number, OutstandingDebt[]>();
  const debtIdsByCustomer = new Map<number, Map<number, OutstandingDebt>>();
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
  );
  const fifoIndexesByCustomer = new Map<number, number>();
  const addEarnings = (date: string, amount: number) => {
    const dateKey = extractStoredDateKey(date);
    transactionsByDate.set(dateKey, (transactionsByDate.get(dateKey) || 0) + amount);
  };

  for (const transaction of sorted) {
    const customerId = transaction.customer_id;
    if (transaction.is_debt === 1) {
      if (customerId == null) continue;
      const customerDebts = debtsByCustomer.get(customerId) || [];
      const outstandingDebt = {
        id: transaction.id,
        principal: Number(transaction.amount) || 0,
        earnings: transaction.deduct_fee === 1 ? 0 : Number(transaction.fee) || 0,
      };
      customerDebts.push(outstandingDebt);
      debtsByCustomer.set(customerId, customerDebts);
      const debtById = debtIdsByCustomer.get(customerId) || new Map<number, OutstandingDebt>();
      debtById.set(outstandingDebt.id, outstandingDebt);
      debtIdsByCustomer.set(customerId, debtById);
      continue;
    }

    if (transaction.type !== 'DEBT_PAYMENT') continue;

    const extraProfit = Number(transaction.fee) || 0;
    addEarnings(transaction.created_at, extraProfit);
    if (customerId == null) continue;

    let remainingPayment = Number(transaction.amount) || 0;
    const customerDebts = debtsByCustomer.get(customerId) || [];
    let fifoIndex = fifoIndexesByCustomer.get(customerId) || 0;
    const targetDebtId = transaction.target_debt_id;
    let contractualEarnings = 0;
    const applyPayment = (debt: OutstandingDebt) => {
      const earningsPaid = Math.min(remainingPayment, debt.earnings);
      debt.earnings -= earningsPaid;
      remainingPayment -= earningsPaid;
      contractualEarnings += earningsPaid;

      const principalPaid = Math.min(remainingPayment, debt.principal);
      debt.principal -= principalPaid;
      remainingPayment -= principalPaid;
    };

    if (targetDebtId != null) {
      const targetDebt = debtIdsByCustomer.get(customerId)?.get(targetDebtId);
      if (targetDebt) applyPayment(targetDebt);
    } else {
      while (remainingPayment > 0 && fifoIndex < customerDebts.length) {
        const debt = customerDebts[fifoIndex];
        applyPayment(debt);
        if (debt.principal <= 0 && debt.earnings <= 0) fifoIndex += 1;
      }
      fifoIndexesByCustomer.set(customerId, fifoIndex);
    }
    addEarnings(transaction.created_at, contractualEarnings);
  }

  return transactionsByDate;
}

export function summarizeEarningsPeriod(
  dailyProfits: DailyProfitItem[],
  startDate: Date,
  endDateExclusive: Date,
): EarningsTimeframeSummary {
  const startKey = getLocalDateKey(startDate);
  const endKey = getLocalDateKey(endDateExclusive);
  return dailyProfits.reduce<EarningsTimeframeSummary>((summary, day) => {
    if (day.dateKey < startKey || day.dateKey >= endKey) return summary;
    summary.grossProfit += day.grossProfit;
    summary.netProfit += day.netProfit;
    summary.txCount += day.txCount;
    return summary;
  }, { grossProfit: 0, netProfit: 0, txCount: 0 });
}

const hydrateWebDb = (parsed: any) => ({
  customers: parsed?.customers || defaultWebDb.customers,
  transactions: parsed?.transactions || defaultWebDb.transactions,
  wallets: { ...defaultWebDb.wallets, ...(parsed?.wallets || {}) },
  settings: { ...defaultWebDb.settings, ...(parsed?.settings || {}) },
});

const loadWebDb = async () => {
  if (typeof window === 'undefined') return defaultWebDb;
  if (cachedWebDb) return cachedWebDb;

  const database = await getWebDbStorageDatabase();
  if (database) {
    if (!webDbChangeChannel && typeof BroadcastChannel !== 'undefined') {
      webDbChangeChannel = new BroadcastChannel(WEB_DB_STORAGE_NAME);
      webDbChangeChannel.onmessage = clearWebDbCache;
    }

    const storedDb = await getWebDbStorageValue(database, WEB_DB_STORAGE_KEY);
    if (storedDb) {
      cachedWebDb = hydrateWebDb(storedDb);
      cachedWebDbInIndexedDb = true;
      if (localStorage.getItem(WEB_DB_STORAGE_VERSION_KEY) !== WEB_DB_STORAGE_VERSION) {
        localStorage.setItem(WEB_DB_STORAGE_VERSION_KEY, WEB_DB_STORAGE_VERSION);
      }
      await repairBrokenWebDebtPayments(cachedWebDb);
      return cachedWebDb;
    }

    const storageVersion = localStorage.getItem(WEB_DB_STORAGE_VERSION_KEY);
    if (storageVersion === WEB_DB_STORAGE_VERSION) {
      throw new Error('Web ledger storage is missing its IndexedDB data. The older local copy was not loaded because it may be stale.');
    }

    const legacyData = localStorage.getItem('counter_db');
    let parsed = defaultWebDb;
    if (legacyData) {
      try {
        parsed = JSON.parse(legacyData);
      } catch {
        parsed = defaultWebDb;
      }
    }
    cachedWebDb = hydrateWebDb(parsed);
    cachedWebDbInIndexedDb = false;
    await repairBrokenWebDebtPayments(cachedWebDb);
    if (!cachedWebDbInIndexedDb) {
      await saveWebDb(cachedWebDb);
    }
    if (storageVersion !== WEB_DB_STORAGE_VERSION) {
      localStorage.setItem(WEB_DB_STORAGE_VERSION_KEY, WEB_DB_STORAGE_VERSION);
    }
    return cachedWebDb;
  }

  const data = localStorage.getItem('counter_db');
  if (data === cachedWebDbRaw && cachedWebDb) return cachedWebDb;
  if (!data) {
    const serialized = JSON.stringify(defaultWebDb);
    const initialDb = JSON.parse(serialized);
    localStorage.setItem('counter_db', serialized);
    cachedWebDbRaw = serialized;
    cachedWebDb = initialDb;
    return initialDb;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    cachedWebDbRaw = data;
    cachedWebDb = defaultWebDb;
    return defaultWebDb;
  }

  const hydratedDb = hydrateWebDb(parsed);
  cachedWebDbRaw = data;
  cachedWebDb = hydratedDb;
  cachedWebDbInIndexedDb = false;
  await repairBrokenWebDebtPayments(hydratedDb);
  return cachedWebDb;
};

const getWebDb = async () => {
  if (typeof window === 'undefined') return defaultWebDb;
  if (cachedWebDb) return cachedWebDb;
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!lockManager) {
    throw new Error('Ledger data cannot be loaded safely because this browser cannot coordinate access across tabs.');
  }
  return lockManager.request(WEB_DB_MUTATION_LOCK, async () => {
    if (cachedWebDb) return cachedWebDb;
    return loadWebDb();
  });
};

const saveWebDb = async (db: any) => {
  if (typeof window === 'undefined') return;

  const database = await getWebDbStorageDatabase();
  try {
    if (database) {
      await setWebDbStorageValues(database, [
        { key: WEB_DB_STORAGE_KEY, value: db },
        { key: WEB_DB_STORAGE_VERSION_KEY, value: WEB_DB_STORAGE_VERSION },
      ]);
      if (localStorage.getItem(WEB_DB_STORAGE_VERSION_KEY) !== WEB_DB_STORAGE_VERSION) {
        localStorage.setItem(WEB_DB_STORAGE_VERSION_KEY, WEB_DB_STORAGE_VERSION);
      }
      cachedWebDbRaw = null;
      cachedWebDb = db;
      cachedWebDbInIndexedDb = true;
      webDbChangeChannel?.postMessage('updated');
    } else {
      const serialized = JSON.stringify(db);
      localStorage.setItem('counter_db', serialized);
      cachedWebDbRaw = serialized;
      cachedWebDb = db;
      cachedWebDbInIndexedDb = false;
    }
    transactionHistoryIndexes = new WeakMap();
    webCustomerNamesByCustomers = new WeakMap();
  } catch (error) {
    clearWebDbCache();
    throw error;
  }
};

const getDebtBalanceForCustomer = (
  transactions: {
    id: number;
    customer_id: number | null;
    is_debt: number;
    deduct_fee?: number;
    fee: number;
    amount: number;
    type: string;
  }[],
  customerId: number,
  excludedTxId?: number
) => {
  return transactions.reduce((sum, tx) => {
    if (tx.customer_id !== customerId || tx.id === excludedTxId) {
      return sum;
    }
    if (tx.is_debt === 1) {
      const fee = tx.deduct_fee === 1 ? 0 : (Number(tx.fee) || 0);
      return sum + (Number(tx.amount) || 0) + fee;
    }
    if (tx.type === 'DEBT_PAYMENT') {
      return sum - (Number(tx.amount) || 0);
    }
    return sum;
  }, 0);
};

const repairBrokenWebDebtPayments = async (db: any) => {
  if (db.settings?.[DEBT_PAYMENT_REPAIR_KEY] === 'done') {
    return;
  }

  const runningBalances = new Map<number, number>();
  const sortedTransactions = [...(db.transactions || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
  );

  for (const tx of sortedTransactions) {
    if (tx.type === 'DEBT_PAYMENT' && tx.customer_id == null) {
      const candidates = Array.from(runningBalances.entries())
        .filter(([, balance]) => roundCurrency(balance) >= roundCurrency(Number(tx.amount) || 0))
        .map(([customerId]) => customerId);

      if (candidates.length === 1) {
        tx.customer_id = candidates[0];
        const originalTx = (db.transactions || []).find((item: any) => item.id === tx.id);
        if (originalTx) {
          originalTx.customer_id = candidates[0];
        }
      }
    }

    if (tx.customer_id != null) {
      const currentBalance = runningBalances.get(tx.customer_id) || 0;
      let delta = 0;
      if (tx.is_debt === 1) {
        delta = (Number(tx.amount) || 0) + (tx.deduct_fee === 1 ? 0 : (Number(tx.fee) || 0));
      } else if (tx.type === 'DEBT_PAYMENT') {
        delta = -(Number(tx.amount) || 0);
      }
      runningBalances.set(tx.customer_id, currentBalance + delta);
    }
  }

  db.settings = {
    ...(db.settings || {}),
    [DEBT_PAYMENT_REPAIR_KEY]: 'done',
  };

  await saveWebDb(db);
};

const getDashboardMetrics = (
  db: any,
  daysLimit = 30,
  sharedDebtAnalysis?: DebtLedgerAnalysis,
) => {
  const transactions = (db.transactions || []) as Transaction[];
  const walletsMap = db.wallets || {};
  const todayStr = getLocalDateKey();
  const transactionAggregate = aggregateDashboardTransactions(transactions, todayStr);
  const dailyTransactionMetrics = transactionAggregate.daily;

  const grossProfit = transactionAggregate.grossProfit;
  const debtAnalysis = sharedDebtAnalysis || analyzeDebtLedger(transactions);
  const debtAllocation = debtAnalysis.allocation;
  const immediateEarnings = transactionAggregate.immediateEarnings;
  const earningsPaid = immediateEarnings + debtAllocation.contractualEarningsPaid + debtAllocation.extraProfitPaid;
  const netProfit = earningsPaid;
  const totalDebt = debtAllocation.pendingPrincipal + debtAllocation.pendingEarnings;

  const collectedDebtEarnings = debtAnalysis.collectedEarningsByDate;

  const wallets = Object.entries(walletsMap).map(([channel, balance]) => ({
    channel,
    balance: Number(balance) || 0
  }));

  const customerNamesById = new Map<number, string>(
    (db.customers || []).map((customer: any) => [Number(customer.id), String(customer.name || '')])
  );
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id)
    .slice(0, 10)
    .map(tx => ({
      ...tx,
      customer_name: tx.customer_id == null ? null : customerNamesById.get(tx.customer_id) || null,
    }));

  // Daily collected earnings and recorded fees for the selected range.
  const dailyProfits: DailyProfitItem[] = [];
  const loopLimit = Math.max(31, daysLimit);
  const now = new Date();
  for (let i = loopLimit - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateStr = getLocalDateKey(d);
    const displayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });

    const dayMetrics = dailyTransactionMetrics.get(dateStr) || { grossProfit: 0, immediateEarnings: 0, txCount: 0 };
    const earningsCollected = dayMetrics.immediateEarnings + (collectedDebtEarnings.get(dateStr) || 0);

    dailyProfits.push({
      dateKey: dateStr,
      date: displayLabel,
      profit: earningsCollected,
      grossProfit: dayMetrics.grossProfit,
      netProfit: earningsCollected,
      pendingEarnings: debtAnalysis.pendingEarningsByDate.get(dateStr) || 0,
      txCount: dayMetrics.txCount,
    });
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const todaySummary = summarizeEarningsPeriod(dailyProfits, todayStart, tomorrow);
  const weekSummary = summarizeEarningsPeriod(dailyProfits, weekStart, tomorrow);
  const monthSummary = summarizeEarningsPeriod(dailyProfits, monthStart, tomorrow);

  const earningsSummary: EarningsSummary = {
    today: todaySummary,
    week: weekSummary,
    month: monthSummary,
  };

  const todayTransactionsCount = transactionAggregate.todayTransactionsCount;
  const debtAddedToday = transactionAggregate.debtAddedToday;
  const debtCollectedToday = transactionAggregate.debtCollectedToday;

  const debtorsMap = new Map<number, any>();
  for (const [customerId, summary] of debtAnalysis.customers.entries()) {
    debtorsMap.set(customerId, {
      id: customerId,
      name: customerNamesById.get(customerId) || 'Unknown',
      balance: summary.balance,
      oldest_debt_date: hasPositiveCurrency(summary.balance) ? summary.oldestUnpaidDebtDate : null,
    });
  }

  const healthChecks: HealthCheckItem[] = [];
  Object.entries(walletsMap).forEach(([channel, balance]) => {
    if ((Number(balance) || 0) >= 0 && (Number(balance) || 0) < 200) {
      healthChecks.push({
        kind: 'low_float',
        label: `${channelNames[channel] || channel} running low`,
        detail: `Only PHP ${(Number(balance) || 0).toFixed(2)} float left`,
        severity: (Number(balance) || 0) < 100 ? 'danger' : 'warning',
      });
    }
  });

  const orphanPayments = transactionAggregate.orphanPayments;
  if (orphanPayments > 0) {
    healthChecks.push({
      kind: 'orphan_payment',
      label: `${orphanPayments} payment record${orphanPayments > 1 ? 's' : ''} need review`,
      detail: 'Some debt payments are missing a linked debtor',
      severity: 'danger',
    });
  }

  Array.from(debtorsMap.values()).forEach((debtor: any) => {
    const ageDays = debtor.oldest_debt_date
      ? Math.floor(Math.abs(new Date().getTime() - new Date(debtor.oldest_debt_date).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    if (hasNegativeCurrency(debtor.balance)) {
      healthChecks.push({
        kind: 'negative_debt',
        label: `${debtor.name} has negative balance`,
        detail: `Overpaid by PHP ${Math.abs(debtor.balance).toFixed(2)}`,
        severity: 'danger',
      });
    } else if (hasPositiveCurrency(debtor.balance) && ageDays >= 7) {
      healthChecks.push({
        kind: 'overdue_debt',
        label: `${debtor.name} is overdue`,
        detail: `${ageDays} days outstanding with PHP ${debtor.balance.toFixed(2)} unpaid`,
        severity: ageDays >= 14 ? 'danger' : 'warning',
      });
    }
  });

  healthChecks.sort((a, b) => {
    const priority = { danger: 0, warning: 1, info: 2 };
    return priority[a.severity] - priority[b.severity];
  });

  return {
    grossProfit,
    netProfit,
    transactionCount: transactions.length,
    totalDebt,
    earningsPaid,
    pendingEarnings: debtAllocation.pendingEarnings,
    principalPaid: debtAllocation.principalPaid,
    pendingPrincipal: debtAllocation.pendingPrincipal,
    todayProfit: todaySummary.netProfit,
    wallets,
    recentTransactions,
    dailyProfits,
    earningsSummary,
    todayTransactionsCount,
    debtAddedToday,
    debtCollectedToday,
    healthChecks: healthChecks.slice(0, 6),
  };
};

const applyTxToWallets = (wallets: any, tx: any, revert = false) => {
  const multiplier = revert ? -1 : 1;
  const amt = (Number(tx.amount) || 0) * multiplier;
  const fee = (Number(tx.fee) || 0) * multiplier;
  const deduct = tx.deduct_fee === 1;

  if (tx.type === 'CASH_IN') {
    wallets[tx.channel] = (wallets[tx.channel] || 0) - (deduct ? amt - fee : amt);
    if (!tx.is_debt) {
      wallets['PHYSICAL_CASH'] = (wallets['PHYSICAL_CASH'] || 0) + (deduct ? amt : amt + fee);
    }
  } else if (tx.type === 'CASH_OUT') {
    if (!tx.is_debt) {
      wallets[tx.channel] = (wallets[tx.channel] || 0) + (deduct ? amt : amt + fee);
    }
    wallets['PHYSICAL_CASH'] = (wallets['PHYSICAL_CASH'] || 0) - (deduct ? amt - fee : amt);
  } else if (tx.type === 'E_LOAD' || tx.type === 'TV_LOAD') {
    wallets[tx.channel] = (wallets[tx.channel] || 0) - amt;
    if (!tx.is_debt) {
      wallets['PHYSICAL_CASH'] = (wallets['PHYSICAL_CASH'] || 0) + amt + fee;
    }
  } else if (tx.type === 'DEBT_PAYMENT') {
    wallets[tx.channel] = (wallets[tx.channel] || 0) + amt + fee;
  }
};

export function useWebDbQueries() {
  const queryClient = useQueryClient();
  const invalidateTransactionData = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['debtors'] });
    queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['wallets'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  };
  const invalidateWalletData = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['wallets'] });
  };
  const invalidateAllLedgerData = () => {
    invalidateTransactionData();
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['settings'] });
  };
  const useWebMutation = <TData, TVariables, TOnMutateResult>(
    options: UseMutationOptions<TData, Error, TVariables, TOnMutateResult>
  ) => {
    const mutationFn = options.mutationFn;
    return useMutation({
      ...options,
      mutationFn: (variables: TVariables, context: MutationFunctionContext) => {
        if (!mutationFn) throw new Error('Ledger mutation is missing its persistence handler.');
        return withWebDbMutationLock(() => mutationFn(variables, context));
      },
    });
  };

  const useDashboardData = (daysLimit = 30, enabled = true) => {
    return useQuery({
      queryKey: ['dashboard', daysLimit],
      enabled,
      queryFn: async () => {
        const db = await getWebDb();
        const debtSnapshot = await queryClient.fetchQuery({
          queryKey: ['debtors'],
          queryFn: loadDebtLedgerSnapshot,
          staleTime: 1000,
        });
        return getDashboardMetrics(db, daysLimit, debtSnapshot.analysis);
      }
    });
  };

  const useCustomers = (enabled = true) => {
    return useQuery({
      queryKey: ['customers'],
      enabled,
      queryFn: async () => {
        const db = await getWebDb();
        return db.customers || [];
      }
    });
  };

  const loadDebtLedgerSnapshot = async (): Promise<DebtLedgerSnapshot> => {
    const db = await getWebDb();
    const transactions = db.transactions || [];
    const debtTransactions: Transaction[] = [];
    const latestTransactionByCustomer = new Map<number, string>();
    for (const tx of transactions) {
      if (tx.customer_id != null) {
        const currentLatest = latestTransactionByCustomer.get(tx.customer_id);
        if (!currentLatest || new Date(tx.created_at).getTime() > new Date(currentLatest).getTime()) {
          latestTransactionByCustomer.set(tx.customer_id, tx.created_at);
        }
      }
      if (tx.is_debt === 1 || tx.type === 'DEBT_PAYMENT') {
        debtTransactions.push(tx);
      }
    }
    const debtAnalysis = analyzeDebtLedger(debtTransactions);
    const debtors: Debtor[] = [];
    for (const customer of db.customers || []) {
      const summary = debtAnalysis.customers.get(customer.id);
      if (!summary) continue;
      debtors.push({
        id: customer.id,
        name: customer.name,
        phone: customer.phone || null,
        notes: customer.notes || '',
        follow_up_status: customer.follow_up_status || 'active',
        last_reminded_at: customer.last_reminded_at || null,
        balance: summary.balance,
        oldest_debt_date: hasPositiveCurrency(summary.balance) ? summary.oldestUnpaidDebtDate : null,
        last_payment_date: summary.lastPaymentDate,
        latest_tx_date: latestTransactionByCustomer.get(customer.id) || null,
      });
    }
    debtors.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    return { debtors, allocation: debtAnalysis.allocation, analysis: debtAnalysis };
  };

  const useDebtors = (enabled = true) => {
    return useQuery({
      queryKey: ['debtors'],
      enabled,
      queryFn: loadDebtLedgerSnapshot,
      staleTime: 1000,
      select: selectDebtLedgerDebtors,
    });
  };

  const useDebtLedgerSummary = (enabled = true) => {
    return useQuery({
      queryKey: ['debtors'],
      enabled,
      queryFn: loadDebtLedgerSnapshot,
      staleTime: 1000,
      select: selectDebtLedgerAllocation,
    });
  };

  const useDebtTransactionsForCustomer = (customerId: number | null, enabled = true) => {
    return useQuery({
      queryKey: ['debt-transactions', 'customer', customerId],
      enabled: enabled && customerId != null,
      queryFn: async () => {
        if (customerId == null) throw new Error('A debtor is required to load ledger history.');
        const db = await getWebDb();
        return sortTransactionsNewestFirst((db.transactions || []).filter(
          (transaction: Transaction) => transaction.customer_id === customerId &&
            (transaction.is_debt === 1 || transaction.type === 'DEBT_PAYMENT')
        ));
      },
    });
  };

  const useDebtTransactionById = (id: number | null, enabled = true) => {
    return useQuery({
      queryKey: ['debt-transactions', 'record', id],
      enabled: enabled && id != null,
      queryFn: async () => {
        if (id == null) throw new Error('A debt record is required.');
        const db = await getWebDb();
        return (db.transactions || []).find((transaction: Transaction) => transaction.id === id && transaction.is_debt === 1) || null;
      },
    });
  };

  const useWallets = (enabled = true) => {
    return useQuery({
      queryKey: ['wallets'],
      enabled,
      queryFn: async () => {
        const db = await getWebDb();
        return Object.entries(db.wallets || {}).map(([channel, balance]) => ({
          channel,
          balance: Number(balance) || 0
        }));
      }
    });
  };

  const useTransactions = (enabled = true) => {
    return useQuery({
      queryKey: ['transactions'],
      enabled,
      queryFn: async () => {
        const db = await getWebDb();
        const customerNamesById = new Map<number, string>((db.customers || []).map((customer: any) => [Number(customer.id), String(customer.name || '')]));
        return [...(db.transactions || [])]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map(tx => {
            return {
              ...tx,
              customer_name: customerNamesById.get(tx.customer_id) || null
            };
          });
      }
    });
  };

  const useLatestRepeatableTransaction = (enabled = true) => {
    return useQuery({
      queryKey: ['transactions', 'latest-repeatable'],
      enabled,
      queryFn: async () => {
        const db = await getWebDb();
        let latest: Transaction | undefined;
        for (const transaction of db.transactions || []) {
          if (!['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD'].includes(transaction.type)) continue;
          if (!latest ||
            transaction.created_at > latest.created_at ||
            (transaction.created_at === latest.created_at && transaction.id > latest.id)) {
            latest = transaction;
          }
        }
        if (!latest) return null;
        const customer = (db.customers || []).find((item: Customer) => item.id === latest?.customer_id);
        return { ...latest, customer_name: customer?.name || null };
      },
    });
  };

  const useTransactionHistory = (filters: TransactionHistoryFilters, enabled = true) => {
    const type = filters.type && filters.type !== 'ALL' ? filters.type : null;
    const search = filters.search?.trim().toLowerCase() || '';
    const channel = filters.channel && filters.channel !== 'ALL' ? filters.channel : null;
    const startDate = filters.startDate || null;
    const endDate = filters.endDate || null;
    return useInfiniteQuery({
      queryKey: ['transactions', 'history', type, search, channel, startDate, endDate],
      enabled,
      initialPageParam: null as TransactionHistoryCursor | null,
      queryFn: async ({ pageParam }): Promise<TransactionHistoryPage> => {
        const db = await getWebDb();
        const customerNamesById = getWebCustomerNamesById(db.customers || []);
        return paginateTransactionHistory(
          db.transactions || [],
          customerNamesById,
          { type: type || 'ALL', search, channel: channel || 'ALL', startDate: startDate || undefined, endDate: endDate || undefined },
          pageParam as TransactionHistoryCursor | null,
        );
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
  };

  const useTransactionById = (id?: number, enabled = true) => {
    return useQuery({
      queryKey: ['transactions', 'record', id],
      enabled: Boolean(id) && enabled,
      queryFn: async () => {
        const db = await getWebDb();
        const transaction = (db.transactions || []).find((item: Transaction) => item.id === id);
        if (!transaction) return null;
        const customer = (db.customers || []).find((item: Customer) => item.id === transaction.customer_id);
        return { ...transaction, customer_name: customer?.name || null } as Transaction;
      },
    });
  };

  const useTransactionsForDate = (dateKey: string, enabled = true) => {
    return useQuery({
      queryKey: ['transactions', 'date', dateKey],
      enabled: Boolean(dateKey) && enabled,
      queryFn: async () => {
        const db = await getWebDb();
        const customerNamesById = new Map((db.customers || []).map((customer: any) => [customer.id, customer.name]));
        return [...(db.transactions || [])]
          .filter((transaction: Transaction) => extractStoredDateKey(transaction.created_at) === dateKey)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((transaction: Transaction) => ({
            ...transaction,
            customer_name: customerNamesById.get(transaction.customer_id) || null,
          }));
      },
    });
  };

  const useAddCustomer = () => {
    return useWebMutation({
      mutationFn: async ({ name, phone }: { name: string; phone?: string }) => {
        const db = await getWebDb();
        const existing = db.customers.find((c: any) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        const newCust = {
          id: getNextWebId(db.customers),
          name,
          phone: phone || '',
          notes: '',
          follow_up_status: 'active',
          last_reminded_at: null,
          created_at: new Date().toISOString()
        };
        db.customers.push(newCust);
        await saveWebDb(db);
        return newCust.id;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      }
    });
  };

  const useDeleteCustomer = () => {
    return useWebMutation({
      mutationFn: async (id: number) => {
        const db = await getWebDb();
        const idx = db.customers.findIndex((c: any) => c.id === id);
        if (idx !== -1) {
          if ((db.transactions || []).some((transaction: Transaction) => transaction.customer_id === id)) {
            throw new Error('Cannot delete a customer with transaction history. Keep the customer record to preserve the ledger history.');
          }
          db.customers.splice(idx, 1);
          await saveWebDb(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    });
  };

  const useUpdateCustomerMeta = () => {
    return useWebMutation({
      mutationFn: async ({ id, phone, notes, follow_up_status, last_reminded_at }: { id: number; phone?: string | null; notes?: string; follow_up_status?: string; last_reminded_at?: string | null }) => {
        const db = await getWebDb();
        const customer = db.customers.find((c: any) => c.id === id);
        if (!customer) return;
        if (phone !== undefined) customer.phone = phone;
        if (notes !== undefined) customer.notes = notes;
        if (follow_up_status !== undefined) customer.follow_up_status = follow_up_status;
        if (last_reminded_at !== undefined) customer.last_reminded_at = last_reminded_at;
        await saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    });
  };

  const useAddTransaction = () => {
    return useWebMutation({
      mutationFn: async (tx: {
        type: 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD' | 'DEBT_PAYMENT';
        amount: number;
        fee: number;
        channel: string;
        customer_id: number | null;
        is_debt: boolean;
        deduct_fee: boolean;
      }) => {
        const db = await getWebDb();
        const normalizedTx = { ...tx, amount: roundCurrency(tx.amount), fee: roundCurrency(tx.fee) };
        assertValidTransactionInput(normalizedTx);
        if (db.wallets[normalizedTx.channel] === undefined) {
          throw new Error('Selected wallet does not exist.');
        }
        if (normalizedTx.customer_id && !db.customers.some((customer: Customer) => customer.id === normalizedTx.customer_id)) {
          throw new Error('Selected debtor does not exist.');
        }
        if (normalizedTx.type === 'DEBT_PAYMENT') {
          if (normalizedTx.customer_id == null) {
            throw new Error('Debt payment must be linked to a debtor.');
          }
          const outstanding = getDebtBalanceForCustomer(db.transactions, normalizedTx.customer_id);
          if (exceedsCurrencyAmount(normalizedTx.amount, outstanding)) {
            throw new Error(`Debt payment cannot exceed the outstanding balance of ${outstanding.toFixed(2)}.`);
          }
        }
        const newTx = {
          id: getNextWebId(db.transactions),
          type: normalizedTx.type,
          amount: normalizedTx.amount,
          fee: normalizedTx.fee,
          channel: normalizedTx.channel,
          customer_id: normalizedTx.customer_id,
          is_debt: normalizedTx.is_debt ? 1 : 0,
          deduct_fee: normalizedTx.deduct_fee ? 1 : 0,
          created_at: new Date().toISOString()
        };

        // Validate wallet balance will not go negative
        const testWallets = { ...db.wallets } as Record<string, number>;
        applyTxToWallets(testWallets, newTx, false);
        const negativeWallet = Object.entries(testWallets).find(([_, bal]) => bal < -0.000001);
        if (negativeWallet) {
          throw new Error(`Insufficient float balance in ${channelNames[negativeWallet[0]] || negativeWallet[0]}.`);
        }

        db.transactions.push(newTx);
        applyTxToWallets(db.wallets, newTx, false);
        await saveWebDb(db);
      },
      onSuccess: () => {
        return invalidateTransactionData();
      }
    });
  };

  const useUpdateTransaction = () => {
    return useWebMutation({
      mutationFn: async (tx: {
        id: number;
        type: Transaction['type'];
        amount: number;
        fee: number;
        channel: string;
        customer_id: number | null;
        is_debt: boolean;
        deduct_fee: boolean;
      }) => {
        const db = await getWebDb();
        const idx = db.transactions.findIndex((t: any) => t.id === tx.id);
        if (idx !== -1) {
          const oldTx = db.transactions[idx];
          const normalizedTx = { ...tx, amount: roundCurrency(tx.amount), fee: roundCurrency(tx.fee) };
          assertValidTransactionInput(normalizedTx);
          if (db.wallets[normalizedTx.channel] === undefined) throw new Error('Selected wallet does not exist.');
          if (normalizedTx.customer_id && !db.customers.some((customer: Customer) => customer.id === normalizedTx.customer_id)) {
            throw new Error('Selected debtor does not exist.');
          }
          const hasTargetedPayments = oldTx.is_debt === 1 && db.transactions.some((item: Transaction) => item.target_debt_id === oldTx.id);
          if (hasTargetedPayments && (
            !normalizedTx.is_debt || normalizedTx.customer_id !== oldTx.customer_id || normalizedTx.amount !== oldTx.amount ||
            normalizedTx.fee !== oldTx.fee || normalizedTx.deduct_fee !== Boolean(oldTx.deduct_fee)
          )) {
            throw new Error('Cannot modify a debt with targeted payments. Delete its targeted payments first.');
          }
          if (normalizedTx.type === 'DEBT_PAYMENT') {
            const customerId = normalizedTx.customer_id;
            if (!customerId) throw new Error('Debt payment must stay linked to a debtor.');
            const targetDebtId = oldTx.target_debt_id && oldTx.customer_id === customerId ? oldTx.target_debt_id : null;
            const outstanding = targetDebtId
              ? getDebtEntryOutstanding(db.transactions.filter((item: Transaction) => item.customer_id === customerId && item.id !== tx.id), targetDebtId)
              : getDebtBalanceForCustomer(db.transactions, customerId, tx.id);
            if (exceedsCurrencyAmount(normalizedTx.amount, outstanding)) {
              throw new Error(`Debt payment cannot exceed the outstanding balance of ${outstanding.toFixed(2)}.`);
            }
          }

          // Dry run balances check
          const testWallets = { ...db.wallets } as Record<string, number>;
          applyTxToWallets(testWallets, oldTx, true); // Revert old

          const updatedTx = {
            ...oldTx,
            type: normalizedTx.type,
            amount: normalizedTx.amount,
            fee: normalizedTx.fee,
            channel: normalizedTx.channel,
            customer_id: normalizedTx.customer_id,
            is_debt: normalizedTx.is_debt ? 1 : 0,
            deduct_fee: normalizedTx.deduct_fee ? 1 : 0,
            target_debt_id: normalizedTx.type === 'DEBT_PAYMENT' && normalizedTx.customer_id === oldTx.customer_id ? oldTx.target_debt_id ?? null : null,
          };
          applyTxToWallets(testWallets, updatedTx, false); // Apply new

          const negativeWallet = Object.entries(testWallets).find(([_, bal]) => bal < -0.000001);
          if (negativeWallet) {
            throw new Error(`Insufficient float balance in ${channelNames[negativeWallet[0]] || negativeWallet[0]}.`);
          }

          // Apply changes
          applyTxToWallets(db.wallets, oldTx, true);
          db.transactions[idx] = updatedTx;
          applyTxToWallets(db.wallets, updatedTx, false);
          await saveWebDb(db);
        }
      },
      onSuccess: () => {
        return invalidateTransactionData();
      }
    });
  };

  const useDeleteTransaction = () => {
    return useWebMutation({
      mutationFn: async (id: number) => {
        const db = await getWebDb();
        const idx = db.transactions.findIndex((t: any) => t.id === id);
        if (idx !== -1) {
          const tx = db.transactions[idx];
          if (tx.is_debt === 1 && db.transactions.some((item: Transaction) => item.target_debt_id === tx.id)) {
            throw new Error('Cannot delete a debt with targeted payments. Delete its targeted payments first.');
          }
          applyTxToWallets(db.wallets, tx, true);
          db.transactions.splice(idx, 1);
          await saveWebDb(db);
        }
      },
      onSuccess: () => {
        return invalidateTransactionData();
      }
    });
  };

  const useSettleDebt = () => {
    return useWebMutation({
      mutationFn: async ({ customer_id, amount, channel, profit, target_debt_id, target_debt_ids }: {
        customer_id: number;
        amount: number;
        channel: string;
        profit?: number;
        target_debt_id?: number;
        target_debt_ids?: number[];
      }) => {
        const db = await getWebDb();
        amount = roundCurrency(amount);
        const extraProfit = roundCurrency(profit || 0);
        assertValidTransactionInput({ type: 'DEBT_PAYMENT', amount, fee: extraProfit, channel, customer_id, is_debt: false });
        if (db.wallets[channel] === undefined) throw new Error('Selected wallet does not exist.');
        if (!db.customers.some((customer: Customer) => customer.id === customer_id)) throw new Error('Selected debtor does not exist.');
        const targetDebtIds = [...new Set(target_debt_ids?.length ? target_debt_ids : target_debt_id ? [target_debt_id] : [])];
        if (targetDebtIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
          throw new Error('Selected debt is invalid.');
        }
        const customerTransactions = db.transactions.filter((tx: Transaction) => tx.customer_id === customer_id);
        const selectedDebts = targetDebtIds.map((id) => {
          const debt = customerTransactions.find((tx: Transaction) => tx.id === id && tx.is_debt === 1);
          if (!debt) throw new Error('Selected debt does not exist for this debtor.');
          if (new Date(debt.created_at).getTime() > Date.now()) throw new Error('A debt cannot be paid before it was recorded.');
          return { id, createdAt: debt.created_at, outstanding: getDebtEntryOutstanding(customerTransactions, id) };
        }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
        const outstanding = selectedDebts.length
          ? selectedDebts.reduce((sum, debt) => sum + debt.outstanding, 0)
          : getDebtBalanceForCustomer(db.transactions, customer_id);
        if (exceedsCurrencyAmount(amount, outstanding)) {
          throw new Error(`Debt payment cannot exceed the outstanding balance of ${outstanding.toFixed(2)}.`);
        }
        const rows = buildTargetedDebtPaymentRecords(selectedDebts, amount, extraProfit);
        const createdAt = new Date().toISOString();
        rows.forEach((payment) => {
          const newTx = {
            id: getNextWebId(db.transactions),
            type: 'DEBT_PAYMENT' as const,
            amount: roundCurrency(payment.amount),
            fee: payment.fee,
            channel,
            customer_id,
            is_debt: 0,
            target_debt_id: payment.targetDebtId,
            created_at: createdAt,
          };
          db.transactions.push(newTx);
          applyTxToWallets(db.wallets, newTx, false);
        });
        await saveWebDb(db);
      },
      onMutate: async ({ customer_id, amount }) => {
        await queryClient.cancelQueries({ queryKey: ['debtors'] });
        const previousLedger = queryClient.getQueryData<DebtLedgerSnapshot>(['debtors']);
        queryClient.setQueryData<DebtLedgerSnapshot>(['debtors'], (current) =>
          applyOptimisticPaymentToLedgerSnapshot(current, customer_id, amount, new Date().toISOString())
        );
        return { previousLedger };
      },
      onError: (_error, _variables, context) => {
        if (context?.previousLedger !== undefined) {
          queryClient.setQueryData(['debtors'], context.previousLedger);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      }
    });
  };

  const useUpdateWalletBalance = () => {
    return useWebMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        const db = await getWebDb();
        if (!Number.isFinite(balance) || balance < 0 || db.wallets[channel] === undefined) {
          throw new Error('Wallet balance must be a non-negative amount for an existing wallet.');
        }
        db.wallets[channel] = roundCurrency(balance);
        await saveWebDb(db);
      },
      onSuccess: () => {
        return invalidateWalletData();
      }
    });
  };

  const useAddWallet = () => {
    return useWebMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        const db = await getWebDb();
        const chKey = channel.trim().toUpperCase();
        if (!chKey) throw new Error("Wallet name cannot be blank.");
        if (!Number.isFinite(balance) || balance < 0) throw new Error('Wallet balance must be a non-negative amount.');
        if (db.wallets[chKey] !== undefined) throw new Error("A wallet with this name already exists.");
        db.wallets[chKey] = roundCurrency(balance);
        await saveWebDb(db);
      },
      onSuccess: () => {
        return invalidateWalletData();
      }
    });
  };

  const useDeleteWallet = () => {
    return useWebMutation({
      mutationFn: async (channel: string) => {
        const db = await getWebDb();
        const chKey = channel.trim().toUpperCase();
        const defaultChannels = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'];
        if (defaultChannels.includes(chKey)) {
          throw new Error("Cannot delete core system wallets.");
        }

        // Verify if any transaction is associated with this wallet
        const hasTx = (db.transactions || []).some((tx: any) => tx.channel?.toUpperCase() === chKey);
        if (hasTx) {
          throw new Error(`Cannot delete wallet: ${channel} has linked transaction logs.`);
        }



        if (db.wallets[chKey] !== undefined) {
          delete db.wallets[chKey];
        } else if (db.wallets[channel] !== undefined) {
          delete db.wallets[channel];
        }
        await saveWebDb(db);
      },
      onSuccess: () => {
        return invalidateWalletData();
      }
    });
  };

  const useResetDatabase = () => {
    return useWebMutation({
      mutationFn: async () => {
        const db = await getWebDb();
        db.transactions = [];
        db.customers = [
          { id: 1, name: 'Sari-Sari Store Cash', phone: '', notes: '', follow_up_status: 'active', last_reminded_at: null, created_at: new Date().toISOString() }
        ];
        for (const k of Object.keys(db.wallets)) {
          db.wallets[k] = 0;
        }
        await saveWebDb(db);
      },
      onSuccess: () => {
        return invalidateAllLedgerData();
      }
    });
  };

  const useSettings = (enabled = true) => {
    return useQuery({
      queryKey: ['settings'],
      enabled,
      queryFn: async () => {
        const db = await getWebDb();
        return db.settings || defaultWebDb.settings;
      }
    });
  };

  const useUpdateSettings = () => {
    return useWebMutation({
      mutationFn: async (newSettings: Record<string, string>) => {
        const db = await getWebDb();
        db.settings = { ...(db.settings || {}), ...newSettings };
        await saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    });
  };

  const useExportData = () => {
    return useQuery({
      queryKey: ['export_data'],
      queryFn: async (): Promise<ExportData> => {
        const db = await getWebDb();
        const transactions = [...(db.transactions || [])]
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((tx: any) => {
            const cust = (db.customers || []).find((c: any) => c.id === tx.customer_id);
            return { ...tx, customer_name: cust ? cust.name : '' };
          });
        // Build debtor summary
        const debtorsMap: Record<number, any> = {};
        for (const tx of (db.transactions || [])) {
          if (tx.customer_id) {
            if (!debtorsMap[tx.customer_id]) {
              const cust = db.customers.find((c: any) => c.id === tx.customer_id);
              debtorsMap[tx.customer_id] = {
                id: tx.customer_id,
                name: cust?.name || 'Unknown',
                phone: cust?.phone || null,
                balance: 0,
                oldest_debt_date: null,
              };
            }
            if (tx.is_debt === 1) {
              const fee = tx.deduct_fee === 1 ? 0 : (Number(tx.fee) || 0);
              debtorsMap[tx.customer_id].balance += (Number(tx.amount) || 0) + fee;
              if (!debtorsMap[tx.customer_id].oldest_debt_date) {
                debtorsMap[tx.customer_id].oldest_debt_date = tx.created_at;
              }
            } else if (tx.type === 'DEBT_PAYMENT') {
              debtorsMap[tx.customer_id].balance -= (Number(tx.amount) || 0);
            }
          }
        }
        const debtors = Object.values(debtorsMap)
          .filter((d: any) => d.balance > 0)
          .sort((a: any, b: any) => b.balance - a.balance);

        return { transactions, debtors };
      },
      enabled: false,
    });
  };

  const useBackupData = () => {
    return useQuery({
      queryKey: ['backup_data'],
      queryFn: async (): Promise<BackupData> => {
        const db = await getWebDb();
        return {
          schema: 'trackapp.backup',
          version: 1,
          exported_at: new Date().toISOString(),
          customers: [...(db.customers || [])],
          transactions: [...(db.transactions || [])],
          wallets: Object.entries(db.wallets || {}).map(([channel, balance]) => ({
            channel,
            balance: Number(balance) || 0,
          })),
          settings: { ...(db.settings || defaultWebDb.settings) },
        };
      },
      enabled: false,
    });
  };

  const useRestoreBackup = () => {
    return useWebMutation({
      mutationFn: async (backup: BackupData) => {
        assertValidBackup(backup);
        const wallets = backup.wallets.reduce<Record<string, number>>((acc, wallet) => {
          const channel = String(wallet.channel || '').trim();
          if (channel) acc[channel] = Number(wallet.balance) || 0;
          return acc;
        }, {});
        const restoredDb = {
          customers: backup.customers || [],
          transactions: backup.transactions || [],
          wallets: { ...defaultWebDb.wallets, ...wallets },
          settings: { ...defaultWebDb.settings, ...(backup.settings || {}) },
        };
        await saveWebDb(restoredDb);
      },
      onSuccess: () => {
        return invalidateAllLedgerData();
      },
    });
  };

  return {
    useDashboardData,
    useCustomers,
    useDebtors,
    useDebtLedgerSummary,
    useDebtTransactionsForCustomer,
    useDebtTransactionById,
    useWallets,
    useTransactions,
    useLatestRepeatableTransaction,
    useTransactionHistory,
    useTransactionById,
    useTransactionsForDate,
    useExportData,
    useBackupData,
    useRestoreBackup,
    useAddCustomer,
    useDeleteCustomer,
    useUpdateCustomerMeta,
    useAddTransaction,
    useUpdateTransaction,
    useDeleteTransaction,
    useSettleDebt,
    useUpdateWalletBalance,
    useAddWallet,
    useDeleteWallet,
    useResetDatabase,
    useSettings,
    useUpdateSettings,
  };
}

/* eslint-disable react-hooks/rules-of-hooks */
export function useDbQueries() {
  if (process.env.EXPO_OS === 'web') {
    return useWebDbQueries();
  }

  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  /* eslint-enable react-hooks/rules-of-hooks */

  // 1. Dashboard Metrics Query
  const useDashboardData = (daysLimit = 30, enabled = true) => {
    return useQuery({
      queryKey: ['dashboard', daysLimit],
      enabled,
      queryFn: async () => {
        const totals = await db.getFirstAsync<{ gross_profit: number; immediate_earnings: number; transaction_count: number }>(`
          SELECT
            COALESCE(SUM(fee), 0) AS gross_profit,
            COALESCE(SUM(CASE WHEN is_debt = 0 AND type != 'DEBT_PAYMENT' THEN fee ELSE 0 END), 0) AS immediate_earnings,
            COUNT(*) AS transaction_count
          FROM transactions
        `);
        const debtSnapshot = await queryClient.fetchQuery({
          queryKey: ['debtors'],
          queryFn: loadDebtLedgerSnapshot,
          staleTime: 1000,
        });
        const debtAnalysis = debtSnapshot.analysis;
        const loopLimit = Math.max(31, daysLimit);
        const today = new Date();
        const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - loopLimit + 1);
        const windowEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        const dailyRows = await db.getAllAsync<{
          date_key: string;
          gross_profit: number;
          immediate_earnings: number;
          tx_count: number;
          debt_added: number;
          debt_collected: number;
        }>(`
          SELECT
            strftime('%Y-%m-%d', created_at, 'localtime') AS date_key,
            COALESCE(SUM(fee), 0) AS gross_profit,
            COALESCE(SUM(CASE WHEN is_debt = 0 AND type != 'DEBT_PAYMENT' THEN fee ELSE 0 END), 0) AS immediate_earnings,
            COUNT(*) AS tx_count,
            COALESCE(SUM(CASE WHEN is_debt = 1 THEN amount + CASE WHEN deduct_fee = 1 THEN 0 ELSE fee END ELSE 0 END), 0) AS debt_added,
            COALESCE(SUM(CASE WHEN type = 'DEBT_PAYMENT' THEN amount ELSE 0 END), 0) AS debt_collected
          FROM transactions
          WHERE created_at >= ? AND created_at < ?
          GROUP BY date_key
        `, [windowStart.toISOString(), windowEnd.toISOString()]);
        const dailyTransactionMetrics = new Map(dailyRows.map(row => [row.date_key, {
          grossProfit: Number(row.gross_profit) || 0,
          immediateEarnings: Number(row.immediate_earnings) || 0,
          txCount: Number(row.tx_count) || 0,
          debtAdded: Number(row.debt_added) || 0,
          debtCollected: Number(row.debt_collected) || 0,
        }]));
        const grossProfit = Number(totals?.gross_profit) || 0;
        const debtAllocation = debtAnalysis.allocation;
        const immediateEarnings = Number(totals?.immediate_earnings) || 0;
        const earningsPaid = immediateEarnings + debtAllocation.contractualEarningsPaid + debtAllocation.extraProfitPaid;
        const netProfit = earningsPaid;
        const totalDebt = debtAllocation.pendingPrincipal + debtAllocation.pendingEarnings;

        const todayStr = getLocalDateKey();
        const collectedDebtEarnings = debtAnalysis.collectedEarningsByDate;

        // Wallet balances
        const wallets = await db.getAllAsync<Wallet>(
          "SELECT channel, balance FROM wallets"
        );

        const recentTransactions = await db.getAllAsync<Transaction>(`
          SELECT t.*, c.name AS customer_name
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT 10
        `);
        const todayMetrics = dailyTransactionMetrics.get(todayStr);
        const todayTransactionsCount = todayMetrics?.txCount || 0;
        const debtAddedToday = todayMetrics?.debtAdded || 0;
        const debtCollectedToday = todayMetrics?.debtCollected || 0;

        // Daily collected earnings and recorded fees for the selected range.
        const dailyProfits: DailyProfitItem[] = [];
        for (let i = loopLimit - 1; i >= 0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
          const dateStr = getLocalDateKey(d);
          const displayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });

          const dayMetrics = dailyTransactionMetrics.get(dateStr) || { grossProfit: 0, immediateEarnings: 0, txCount: 0 };
          const earningsCollected = dayMetrics.immediateEarnings + (collectedDebtEarnings.get(dateStr) || 0);

          dailyProfits.push({
            dateKey: dateStr,
            date: displayLabel,
            profit: earningsCollected,
            grossProfit: dayMetrics.grossProfit,
            netProfit: earningsCollected,
            pendingEarnings: debtAnalysis.pendingEarningsByDate.get(dateStr) || 0,
            txCount: dayMetrics.txCount,
          });
        }

        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const tomorrow = new Date(todayStart);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const todaySummary = summarizeEarningsPeriod(dailyProfits, todayStart, tomorrow);
        const weekSummary = summarizeEarningsPeriod(dailyProfits, weekStart, tomorrow);
        const monthSummary = summarizeEarningsPeriod(dailyProfits, monthStart, tomorrow);

        const earningsSummary: EarningsSummary = {
          today: todaySummary,
          week: weekSummary,
          month: monthSummary,
        };

        const customerNameById = new Map<number, string>(
          debtSnapshot.debtors.map((debtor) => [debtor.id, debtor.name])
        );
        const overdueDebtors: { name: string; balance: number; oldest_debt_date: string | null }[] = [];
        for (const [customerId, summary] of debtAnalysis.customers.entries()) {
          if (hasNonZeroCurrency(summary.balance)) {
            const oldest_debt_date = hasPositiveCurrency(summary.balance) ? summary.oldestUnpaidDebtDate : null;
            overdueDebtors.push({
              name: customerNameById.get(customerId) || 'Unknown',
              balance: summary.balance,
              oldest_debt_date,
            });
          }
        }

        const orphanPaymentsResult = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) as count FROM transactions WHERE type = 'DEBT_PAYMENT' AND customer_id IS NULL"
        );
        const healthChecks: HealthCheckItem[] = [];
        wallets.forEach((wallet) => {
          if (wallet.balance >= 0 && wallet.balance < 200) {
            healthChecks.push({
              kind: 'low_float',
              label: `${channelNames[wallet.channel] || wallet.channel} running low`,
              detail: `Only PHP ${wallet.balance.toFixed(2)} float left`,
              severity: wallet.balance < 100 ? 'danger' : 'warning',
            });
          }
        });
        overdueDebtors.forEach((debtor) => {
          const ageDays = debtor.oldest_debt_date
            ? Math.floor(Math.abs(new Date().getTime() - new Date(debtor.oldest_debt_date).getTime()) / (1000 * 60 * 60 * 24))
            : 0;
          if (hasNegativeCurrency(debtor.balance)) {
            healthChecks.push({
              kind: 'negative_debt',
              label: `${debtor.name} has negative balance`,
              detail: `Overpaid by PHP ${Math.abs(debtor.balance).toFixed(2)}`,
              severity: 'danger',
            });
          } else if (ageDays >= 7) {
            healthChecks.push({
              kind: 'overdue_debt',
              label: `${debtor.name} is overdue`,
              detail: `${ageDays} days outstanding with PHP ${debtor.balance.toFixed(2)} unpaid`,
              severity: ageDays >= 14 ? 'danger' : 'warning',
            });
          }
        });
        if ((orphanPaymentsResult?.count ?? 0) > 0) {
          healthChecks.push({
            kind: 'orphan_payment',
            label: `${orphanPaymentsResult?.count ?? 0} payment record${(orphanPaymentsResult?.count ?? 0) > 1 ? 's' : ''} need review`,
            detail: 'Some debt payments are missing a linked debtor',
            severity: 'danger',
          });
        }
        healthChecks.sort((a, b) => {
          const priority = { danger: 0, warning: 1, info: 2 };
          return priority[a.severity] - priority[b.severity];
        });

        return {
          grossProfit,
          netProfit,
          transactionCount: Number(totals?.transaction_count) || 0,
          totalDebt,
          earningsPaid,
          pendingEarnings: debtAllocation.pendingEarnings,
          principalPaid: debtAllocation.principalPaid,
          pendingPrincipal: debtAllocation.pendingPrincipal,
          todayProfit: todaySummary.netProfit,
          wallets,
          recentTransactions,
          dailyProfits,
          earningsSummary,
          todayTransactionsCount,
          debtAddedToday,
          debtCollectedToday,
          healthChecks: healthChecks.slice(0, 6),
        };
      },
    });
  };

  // 2. Customers List Query
  const useCustomers = (enabled = true) => {
    return useQuery({
      queryKey: ['customers'],
      enabled,
      queryFn: async () => {
        return await db.getAllAsync<Customer>(
          "SELECT * FROM customers ORDER BY name ASC"
        );
      },
    });
  };

  // 3. Debtors Tracker Query
  const useDebtors = (enabled = true) => {
    return useQuery({
      queryKey: ['debtors'],
      enabled,
      queryFn: loadDebtLedgerSnapshot,
      staleTime: 1000,
      select: selectDebtLedgerDebtors,
    });
  };

  const loadDebtLedgerSnapshot = async (): Promise<DebtLedgerSnapshot> => {
    const [customers, transactions, latestActivityRows] = await Promise.all([
      db.getAllAsync<Customer>(`
        SELECT id, name, phone, notes, follow_up_status, last_reminded_at
        FROM customers
        ORDER BY name ASC
      `),
      db.getAllAsync<Transaction>(`
        SELECT id, type, amount, fee, customer_id, is_debt, deduct_fee, target_debt_id, created_at
        FROM transactions
        WHERE is_debt = 1 OR type = 'DEBT_PAYMENT'
        ORDER BY created_at ASC, id ASC
      `),
      db.getAllAsync<{ customer_id: number; latest_tx_date: string }>(`
        SELECT customer_id, MAX(created_at) AS latest_tx_date
        FROM transactions
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      `),
    ]);
    const latestTransactionByCustomer = new Map(
      latestActivityRows.map((row) => [row.customer_id, row.latest_tx_date])
    );
    const debtAnalysis = analyzeDebtLedger(transactions);
    const debtors: Debtor[] = [];
    for (const customer of customers) {
      const summary = debtAnalysis.customers.get(customer.id);
      if (!summary) continue;
      debtors.push({
        id: customer.id,
        name: customer.name,
        phone: customer.phone || null,
        notes: customer.notes || null,
        follow_up_status: customer.follow_up_status || 'active',
        last_reminded_at: customer.last_reminded_at || null,
        balance: summary.balance,
        oldest_debt_date: hasPositiveCurrency(summary.balance) ? summary.oldestUnpaidDebtDate : null,
        last_payment_date: summary.lastPaymentDate,
        // Keep recent-activity sorting consistent with web: include every
        // customer-linked transaction, not only debt and payment ledger rows.
        latest_tx_date: latestTransactionByCustomer.get(customer.id) || summary.latestTransactionDate,
      });
    }
    debtors.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    return { debtors, allocation: debtAnalysis.allocation, analysis: debtAnalysis };
  };

  const useDebtLedgerSummary = (enabled = true) => {
    return useQuery({
      queryKey: ['debtors'],
      enabled,
      queryFn: loadDebtLedgerSnapshot,
      staleTime: 1000,
      select: selectDebtLedgerAllocation,
    });
  };

  const useDebtTransactionsForCustomer = (customerId: number | null, enabled = true) => {
    return useQuery({
      queryKey: ['debt-transactions', 'customer', customerId],
      enabled: enabled && customerId != null,
      queryFn: async () => {
        if (customerId == null) throw new Error('A debtor is required to load ledger history.');
        return db.getAllAsync<Transaction>(`
          SELECT id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, target_debt_id, created_at
          FROM transactions
          WHERE customer_id = ? AND (is_debt = 1 OR type = 'DEBT_PAYMENT')
          ORDER BY created_at DESC, id DESC
        `, [customerId]);
      },
    });
  };

  const useDebtTransactionById = (id: number | null, enabled = true) => {
    return useQuery({
      queryKey: ['debt-transactions', 'record', id],
      enabled: enabled && id != null,
      queryFn: async () => {
        if (id == null) throw new Error('A debt record is required.');
        return db.getFirstAsync<Transaction>(`
          SELECT id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, target_debt_id, created_at
          FROM transactions
          WHERE id = ? AND is_debt = 1
        `, [id]);
      },
    });
  };

  // 5. Digital Wallets Query
  const useWallets = (enabled = true) => {
    return useQuery({
      queryKey: ['wallets'],
      enabled,
      queryFn: async () => {
        return await db.getAllAsync<Wallet>(
          "SELECT channel, balance FROM wallets"
        );
      },
    });
  };

  // 5.5 All Transactions Query
  const useTransactions = (enabled = true) => {
    return useQuery({
      queryKey: ['transactions'],
      enabled,
      queryFn: async () => {
        return await db.getAllAsync<Transaction>(`
          SELECT t.*, c.name as customer_name 
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          ORDER BY t.created_at DESC
        `);
      },
    });
  };

  const useLatestRepeatableTransaction = (enabled = true) => {
    return useQuery({
      queryKey: ['transactions', 'latest-repeatable'],
      enabled,
      queryFn: async () => db.getFirstAsync<Transaction>(`
        SELECT *
        FROM transactions
        WHERE type IN ('CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `),
    });
  };

  const useTransactionHistory = (filters: TransactionHistoryFilters, enabled = true) => {
    const type = filters.type && filters.type !== 'ALL' ? filters.type : null;
    const search = filters.search?.trim().toLowerCase() || '';
    const channel = filters.channel && filters.channel !== 'ALL' ? filters.channel : null;
    const startDate = filters.startDate || null;
    const endDate = filters.endDate || null;
    const filterKey = JSON.stringify([type, search, channel, startDate, endDate]);
    const totalRef = useRef<{ filterKey: string; total: number } | null>(null);
    return useInfiniteQuery({
      queryKey: ['transactions', 'history', type, search, channel, startDate, endDate],
      enabled,
      initialPageParam: null as TransactionHistoryCursor | null,
      queryFn: async ({ pageParam }): Promise<TransactionHistoryPage> => {
        const cursor = pageParam as TransactionHistoryCursor | null;
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (type) {
          where.push('t.type = ?');
          params.push(type);
        }
        if (channel) {
          where.push('t.channel = ?');
          params.push(channel);
        }
        if (startDate) {
          where.push('t.created_at >= ?');
          params.push(startDate);
        }
        if (endDate) {
          where.push('t.created_at < ?');
          params.push(endDate);
        }
        if (search) {
          where.push("(LOWER(COALESCE(c.name, 'anonymous transaction')) LIKE ? OR LOWER(t.channel) LIKE ? OR CAST(t.amount AS TEXT) LIKE ?)");
          const pattern = `%${search}%`;
          params.push(pattern, pattern, pattern);
        }
        const filtersWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
        let total = cursor && totalRef.current?.filterKey === filterKey ? totalRef.current.total : null;
        if (total === null) {
          const countFrom = search
            ? 'FROM transactions t LEFT JOIN customers c ON t.customer_id = c.id'
            : 'FROM transactions t';
          const countResult = await db.getFirstAsync<{ total: number }>(`
            SELECT COUNT(*) AS total
            ${countFrom}
            ${filtersWhere}
          `, params);
          total = countResult?.total ?? 0;
          totalRef.current = { filterKey, total };
        }
        if (cursor) {
          where.push('(t.created_at < ? OR (t.created_at = ? AND t.id < ?))');
          params.push(cursor.createdAt, cursor.createdAt, cursor.id);
        }
        const pageWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pageWithLookahead = await db.getAllAsync<Transaction>(`
          SELECT t.*, c.name AS customer_name
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          ${pageWhere}
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT ?
        `, [...params, HISTORY_PAGE_SIZE + 1]);
        const transactions = pageWithLookahead.slice(0, HISTORY_PAGE_SIZE);
        const last = transactions.at(-1);
        return {
          transactions,
          total,
          nextCursor: pageWithLookahead.length > HISTORY_PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : undefined,
        };
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    });
  };

  const useTransactionById = (id?: number, enabled = true) => {
    return useQuery({
      queryKey: ['transactions', 'record', id],
      enabled: Boolean(id) && enabled,
      queryFn: async () => {
        if (!id) return null;
        return await db.getFirstAsync<Transaction>(`
          SELECT t.*, c.name AS customer_name
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          WHERE t.id = ?
        `, [id]);
      },
    });
  };

  const useTransactionsForDate = (dateKey: string, enabled = true) => {
    return useQuery({
      queryKey: ['transactions', 'date', dateKey],
      enabled: Boolean(dateKey) && enabled,
      queryFn: async () => {
        const rangeStart = new Date(`${dateKey}T00:00:00`).toISOString();
        const rangeEndDate = new Date(`${dateKey}T00:00:00`);
        rangeEndDate.setDate(rangeEndDate.getDate() + 1);
        const rangeEnd = rangeEndDate.toISOString();
        return await db.getAllAsync<Transaction>(`
          SELECT t.*, c.name as customer_name
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          WHERE t.created_at >= ? AND t.created_at < ?
          ORDER BY t.created_at DESC
        `, [rangeStart, rangeEnd]);
      },
    });
  };

  // --- MUTATIONS ---

  // Add Customer Mutation
  const useAddCustomer = () => {
    return useMutation({
      mutationFn: async ({ name, phone }: { name: string; phone?: string }) => {
        const createdAt = new Date().toISOString();
        const result = await db.runAsync(
          "INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)",
          [name.trim(), phone || null, createdAt]
        );
        return result.lastInsertRowId;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      },
    });
  };

  // Delete Customer Mutation
  const useDeleteCustomer = () => {
    return useMutation({
      mutationFn: async (id: number) => {
        const history = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM transactions WHERE customer_id = ?',
          [id]
        );
        if ((history?.count ?? 0) > 0) {
          throw new Error('Cannot delete a customer with transaction history. Keep the customer record to preserve the ledger history.');
        }
        await db.runAsync("DELETE FROM customers WHERE id = ?", [id]);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
      },
    });
  };

  const useUpdateCustomerMeta = () => {
    return useMutation({
      mutationFn: async ({ id, phone, notes, follow_up_status, last_reminded_at }: { id: number; phone?: string | null; notes?: string; follow_up_status?: string; last_reminded_at?: string | null }) => {
        const current = await db.getFirstAsync<{ phone: string | null; notes: string | null; follow_up_status: string | null; last_reminded_at: string | null }>(
          "SELECT phone, notes, follow_up_status, last_reminded_at FROM customers WHERE id = ?",
          [id]
        );
        await db.runAsync(
          "UPDATE customers SET phone = ?, notes = ?, follow_up_status = ?, last_reminded_at = ? WHERE id = ?",
          [
            phone !== undefined ? phone : current?.phone ?? null,
            notes ?? current?.notes ?? null,
            follow_up_status ?? current?.follow_up_status ?? 'active',
            last_reminded_at !== undefined ? last_reminded_at : current?.last_reminded_at ?? null,
            id,
          ]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
      },
    });
  };

  // Add Transaction Mutation
  const useAddTransaction = () => {
    return useMutation({
      mutationFn: async (tx: {
        type: Transaction['type'];
        amount: number;
        fee: number;
        channel: string;
        customer_id: number | null;
        is_debt: boolean;
        deduct_fee: boolean;
      }) => {
        const normalizedTx = { ...tx, amount: roundCurrency(tx.amount), fee: roundCurrency(tx.fee) };
        assertValidTransactionInput(normalizedTx);
        const wallet = await db.getFirstAsync<{ channel: string }>("SELECT channel FROM wallets WHERE channel = ?", [normalizedTx.channel]);
        if (!wallet) throw new Error('Selected wallet does not exist.');
        if (normalizedTx.customer_id) {
          const customer = await db.getFirstAsync<{ id: number }>("SELECT id FROM customers WHERE id = ?", [normalizedTx.customer_id]);
          if (!customer) throw new Error('Selected debtor does not exist.');
        }
        const createdAt = new Date().toISOString();
        const isDebtInt = normalizedTx.is_debt ? 1 : 0;
        const deductFeeInt = normalizedTx.deduct_fee ? 1 : 0;
        await db.runAsync(
          "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [normalizedTx.type, normalizedTx.amount, normalizedTx.fee, normalizedTx.channel, normalizedTx.customer_id, isDebtInt, deductFeeInt, createdAt]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      },
    });
  };

  // Update Transaction Mutation
  const useUpdateTransaction = () => {
    return useMutation({
      mutationFn: async (tx: {
        id: number;
        type: Transaction['type'];
        amount: number;
        fee: number;
        channel: string;
        customer_id: number | null;
        is_debt: boolean;
        deduct_fee: boolean;
      }) => {
        const normalizedTx = { ...tx, amount: roundCurrency(tx.amount), fee: roundCurrency(tx.fee) };
        assertValidTransactionInput(normalizedTx);
        const wallet = await db.getFirstAsync<{ channel: string }>("SELECT channel FROM wallets WHERE channel = ?", [normalizedTx.channel]);
        if (!wallet) throw new Error('Selected wallet does not exist.');
        if (normalizedTx.customer_id) {
          const customer = await db.getFirstAsync<{ id: number }>("SELECT id FROM customers WHERE id = ?", [normalizedTx.customer_id]);
          if (!customer) throw new Error('Selected debtor does not exist.');
        }
        const isDebtInt = normalizedTx.is_debt ? 1 : 0;
        const deductFeeInt = normalizedTx.deduct_fee ? 1 : 0;
        const existingTx = await db.getFirstAsync<Pick<Transaction, 'customer_id' | 'target_debt_id' | 'is_debt' | 'amount' | 'fee' | 'deduct_fee'>>(
          'SELECT customer_id, target_debt_id, is_debt, amount, fee, deduct_fee FROM transactions WHERE id = ?', [tx.id]
        );
        const dependentPayment = existingTx?.is_debt === 1
          ? await db.getFirstAsync<{ id: number }>('SELECT id FROM transactions WHERE target_debt_id = ? LIMIT 1', [tx.id])
          : null;
        if (dependentPayment && (
          !normalizedTx.is_debt || normalizedTx.customer_id !== existingTx?.customer_id || normalizedTx.amount !== existingTx.amount ||
          normalizedTx.fee !== existingTx.fee || normalizedTx.deduct_fee !== Boolean(existingTx.deduct_fee)
        )) {
          throw new Error('Cannot modify a debt with targeted payments. Delete its targeted payments first.');
        }
        const targetDebtId = normalizedTx.type === 'DEBT_PAYMENT' && existingTx?.customer_id === normalizedTx.customer_id
          ? existingTx.target_debt_id ?? null
          : null;
        if (normalizedTx.type === 'DEBT_PAYMENT') {
          const debtResult = await db.getFirstAsync<{ balance: number }>(
            `
              SELECT
                COALESCE(SUM(CASE WHEN is_debt = 1 THEN (amount + (CASE WHEN deduct_fee = 1 THEN 0 ELSE fee END)) ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN type = 'DEBT_PAYMENT' THEN amount ELSE 0 END), 0) AS balance
              FROM transactions
              WHERE customer_id = ? AND id != ?
            `,
            [normalizedTx.customer_id, tx.id]
          );
          const customerTransactions = await db.getAllAsync<Transaction>('SELECT * FROM transactions WHERE customer_id = ? AND id != ?', [normalizedTx.customer_id, tx.id]);
          const outstanding = targetDebtId ? getDebtEntryOutstanding(customerTransactions, targetDebtId) : debtResult?.balance ?? 0;
          if (exceedsCurrencyAmount(normalizedTx.amount, outstanding)) {
            throw new Error(`Debt payment cannot exceed the outstanding balance of ${outstanding.toFixed(2)}.`);
          }
        }
        await db.runAsync(
          "UPDATE transactions SET type = ?, amount = ?, fee = ?, channel = ?, customer_id = ?, is_debt = ?, deduct_fee = ?, target_debt_id = ? WHERE id = ?",
          [normalizedTx.type, normalizedTx.amount, normalizedTx.fee, normalizedTx.channel, normalizedTx.customer_id, isDebtInt, deductFeeInt, targetDebtId, tx.id]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      },
    });
  };

  // Delete Transaction Mutation
  const useDeleteTransaction = () => {
    return useMutation({
      mutationFn: async (id: number) => {
        await db.runAsync("DELETE FROM transactions WHERE id = ?", [id]);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      },
    });
  };

  // Settle Debt Mutation
  const useSettleDebt = () => {
    return useMutation({
      mutationFn: async ({
        customer_id,
        amount,
        channel,
        profit,
        target_debt_id,
        target_debt_ids,
      }: {
        customer_id: number;
        amount: number;
        channel: string;
        profit?: number;
        target_debt_id?: number;
        target_debt_ids?: number[];
      }) => {
        const createdAt = new Date().toISOString();
        amount = roundCurrency(amount);
        const extraProfit = roundCurrency(profit || 0);
        assertValidTransactionInput({ type: 'DEBT_PAYMENT', amount, fee: extraProfit, channel, customer_id, is_debt: false });
        await db.withExclusiveTransactionAsync(async (txn) => {
          const wallet = await txn.getFirstAsync<{ channel: string }>("SELECT channel FROM wallets WHERE channel = ?", [channel]);
          if (!wallet) throw new Error('Selected wallet does not exist.');
          const customer = await txn.getFirstAsync<{ id: number }>("SELECT id FROM customers WHERE id = ?", [customer_id]);
          if (!customer) throw new Error('Selected debtor does not exist.');
          const targetDebtIds = [...new Set(target_debt_ids?.length ? target_debt_ids : target_debt_id ? [target_debt_id] : [])];
          if (targetDebtIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
            throw new Error('Selected debt is invalid.');
          }
          const customerTransactions = await txn.getAllAsync<Transaction>(`
            SELECT id, type, amount, fee, is_debt, deduct_fee, target_debt_id, created_at
            FROM transactions WHERE customer_id = ?
            ORDER BY created_at ASC, id ASC
          `, [customer_id]);
          const selectedDebts = targetDebtIds.map((id) => {
            const debt = customerTransactions.find((tx) => tx.id === id && tx.is_debt === 1);
            if (!debt) throw new Error('Selected debt does not exist for this debtor.');
            if (new Date(debt.created_at).getTime() > new Date(createdAt).getTime()) {
              throw new Error('A debt cannot be paid before it was recorded.');
            }
            return { id, createdAt: debt.created_at, outstanding: getDebtEntryOutstanding(customerTransactions, id) };
          }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
          const debtResult = await txn.getFirstAsync<{ balance: number }>(
            `SELECT
              COALESCE(SUM(CASE WHEN is_debt = 1 THEN amount + CASE WHEN deduct_fee = 1 THEN 0 ELSE fee END ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN type = 'DEBT_PAYMENT' THEN amount ELSE 0 END), 0) AS balance
             FROM transactions WHERE customer_id = ?`,
            [customer_id]
          );
          const outstanding = selectedDebts.length
            ? selectedDebts.reduce((sum, debt) => sum + debt.outstanding, 0)
            : debtResult?.balance ?? 0;
          if (exceedsCurrencyAmount(amount, outstanding)) {
            throw new Error(`Debt payment cannot exceed the outstanding balance of ${outstanding.toFixed(2)}.`);
          }
          const rows = buildTargetedDebtPaymentRecords(selectedDebts, amount, extraProfit);
          for (const payment of rows) {
            await txn.runAsync(
              "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, target_debt_id, created_at) VALUES ('DEBT_PAYMENT', ?, ?, ?, ?, 0, ?, ?)",
              [roundCurrency(payment.amount), payment.fee, channel, customer_id, payment.targetDebtId, createdAt]
            );
          }
        });
      },
      onMutate: async ({ customer_id, amount }) => {
        await queryClient.cancelQueries({ queryKey: ['debtors'] });
        const previousLedger = queryClient.getQueryData<DebtLedgerSnapshot>(['debtors']);
        queryClient.setQueryData<DebtLedgerSnapshot>(['debtors'], (current) =>
          applyOptimisticPaymentToLedgerSnapshot(current, customer_id, amount, new Date().toISOString())
        );
        return { previousLedger };
      },
      onError: (_error, _variables, context) => {
        if (context?.previousLedger !== undefined) {
          queryClient.setQueryData(['debtors'], context.previousLedger);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      },
    });
  };

  // Update Wallet Float Mutation
  const useUpdateWalletBalance = () => {
    return useMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        if (!Number.isFinite(balance) || balance < 0) {
          throw new Error('Wallet balance must be a non-negative amount.');
        }
        const wallet = await db.getFirstAsync<{ channel: string }>("SELECT channel FROM wallets WHERE channel = ?", [channel]);
        if (!wallet) throw new Error('Selected wallet does not exist.');
        await db.runAsync(
          "UPDATE wallets SET balance = ? WHERE channel = ?",
          [roundCurrency(balance), channel]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      },
    });
  };

  // Add Wallet Mutation
  const useAddWallet = () => {
    return useMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        const chKey = channel.trim().toUpperCase();
        if (!chKey) throw new Error("Wallet name cannot be blank.");
        if (!Number.isFinite(balance) || balance < 0) throw new Error('Wallet balance must be a non-negative amount.');

        const existing = await db.getFirstAsync<{ channel: string }>(
          "SELECT channel FROM wallets WHERE UPPER(channel) = ?",
          [chKey]
        );
        if (existing) {
          throw new Error("A wallet with this name already exists.");
        }

        await db.runAsync(
          "INSERT INTO wallets (channel, balance) VALUES (?, ?)",
          [channel.trim(), roundCurrency(balance)]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      },
    });
  };

  // Delete Wallet Mutation
  const useDeleteWallet = () => {
    return useMutation({
      mutationFn: async (channel: string) => {
        const chUpper = channel.toUpperCase();
        const defaultChannels = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'];
        if (defaultChannels.includes(chUpper)) {
          throw new Error("Cannot delete core system wallets.");
        }

        // Verify if any transaction is associated with this wallet
        const txCount = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) as count FROM transactions WHERE UPPER(channel) = ?",
          [chUpper]
        );
        if (txCount && txCount.count > 0) {
          throw new Error(`Cannot delete wallet: ${channel} has linked transaction logs.`);
        }



        await db.runAsync("DELETE FROM wallets WHERE channel = ?", [channel]);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      },
    });
  };

  // Reset Database Mutation
  const useResetDatabase = () => {
    return useMutation({
      mutationFn: async () => {
        await db.execAsync(`
          DROP TRIGGER IF EXISTS tr_transaction_insert;
          DROP TRIGGER IF EXISTS tr_transaction_delete;
          DROP TRIGGER IF EXISTS tr_transaction_update;
          DROP TRIGGER IF EXISTS tr_wallet_balance_guard;
          DROP TRIGGER IF EXISTS tr_transaction_validate_insert;
          DROP TRIGGER IF EXISTS tr_transaction_validate_update;
          DROP TRIGGER IF EXISTS tr_transaction_validate_delete;
          DROP TRIGGER IF EXISTS tr_customer_delete_with_balance_guard;
        `);

        try {
          await db.withTransactionAsync(async () => {
            await db.execAsync("DELETE FROM transactions");
            await db.execAsync("DELETE FROM customers");
            await db.execAsync("UPDATE wallets SET balance = 0.0");
          });
        } finally {
          await migrateDbIfNeeded(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      },
    });
  };

  // Fetch Settings Query
  const useSettings = (enabled = true) => {
    return useQuery({
      queryKey: ['settings'],
      enabled,
      queryFn: async () => {
        const rows = await db.getAllAsync<{ key: string; value: string }>(
          "SELECT key, value FROM settings"
        );
        const config: Record<string, string> = {};
        for (const row of rows) {
          config[row.key] = row.value;
        }
        return config;
      }
    });
  };

  // Update Settings Mutation
  const useUpdateSettings = () => {
    return useMutation({
      mutationFn: async (newSettings: Record<string, string>) => {
        for (const [key, val] of Object.entries(newSettings)) {
          await db.runAsync(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [key, val]
          );
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    });
  };

  // Export Data Query (all transactions and debtors for CSV)
  const useExportData = () => {
    return useQuery({
      queryKey: ['export_data'],
      queryFn: async (): Promise<ExportData> => {
        const rows = await db.getAllAsync<{
          id: number; type: string; amount: number; fee: number;
          channel: string; customer_id: number | null; is_debt: number;
          deduct_fee: number; created_at: string; customer_name?: string;
        }>(`
          SELECT t.*, c.name as customer_name 
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          ORDER BY t.created_at DESC
        `);
        const transactions = rows as (Transaction & { customer_name?: string | null })[];
        // Debtor summary for export using FIFO debt settlement
        const customers = await db.getAllAsync<Customer>("SELECT * FROM customers ORDER BY name ASC");
        const allTx = await db.getAllAsync<Transaction>(
          "SELECT * FROM transactions WHERE customer_id IS NOT NULL AND (is_debt = 1 OR type = 'DEBT_PAYMENT') ORDER BY created_at ASC"
        );
        const debtAnalysis = analyzeDebtLedger(allTx);

        const debtors: Debtor[] = [];
        for (const cust of customers) {
          const summary = debtAnalysis.customers.get(cust.id);
          if (!summary) continue;

          if (hasNonZeroCurrency(summary.balance)) {
            debtors.push({
              id: cust.id,
              name: cust.name,
              phone: cust.phone || null,
              notes: cust.notes || null,
              follow_up_status: cust.follow_up_status || 'active',
              last_reminded_at: cust.last_reminded_at || null,
              balance: summary.balance,
              oldest_debt_date: hasPositiveCurrency(summary.balance) ? summary.oldestUnpaidDebtDate : null,
            });
          }
        }
        debtors.sort((a, b) => b.balance - a.balance);

        return { transactions, debtors };
      },
      enabled: false,
    });
  };

  const useBackupData = () => {
    return useQuery({
      queryKey: ['backup_data'],
      queryFn: async (): Promise<BackupData> => {
        const customers = await db.getAllAsync<Customer>(
          "SELECT id, name, phone, notes, follow_up_status, last_reminded_at, created_at FROM customers ORDER BY id ASC"
        );
        const transactions = await db.getAllAsync<Transaction>(
          "SELECT id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, target_debt_id, created_at FROM transactions ORDER BY id ASC"
        );
        const wallets = await db.getAllAsync<Wallet>(
          "SELECT channel, balance FROM wallets ORDER BY channel ASC"
        );
        const settingsRows = await db.getAllAsync<{ key: string; value: string }>(
          "SELECT key, value FROM settings"
        );
        const settings: Record<string, string> = {};
        for (const row of settingsRows) {
          settings[row.key] = row.value;
        }
        return {
          schema: 'trackapp.backup',
          version: 1,
          exported_at: new Date().toISOString(),
          customers,
          transactions,
          wallets,
          settings,
        };
      },
      enabled: false,
    });
  };

  const useRestoreBackup = () => {
    return useMutation({
      mutationFn: async (backup: BackupData) => {
        assertValidBackup(backup);

        await db.execAsync(`
          DROP TRIGGER IF EXISTS tr_transaction_insert;
          DROP TRIGGER IF EXISTS tr_transaction_delete;
          DROP TRIGGER IF EXISTS tr_transaction_update;
          DROP TRIGGER IF EXISTS tr_wallet_balance_guard;
          DROP TRIGGER IF EXISTS tr_transaction_validate_insert;
          DROP TRIGGER IF EXISTS tr_transaction_validate_update;
          DROP TRIGGER IF EXISTS tr_transaction_validate_delete;
          DROP TRIGGER IF EXISTS tr_customer_delete_with_balance_guard;
        `);

        try {
          await db.withTransactionAsync(async () => {
            await db.execAsync("DELETE FROM transactions");
            await db.execAsync("DELETE FROM customers");
            await db.execAsync("DELETE FROM wallets");
            await db.execAsync("DELETE FROM settings");

            for (const customer of backup.customers) {
              await db.runAsync(
                "INSERT INTO customers (id, name, phone, notes, follow_up_status, last_reminded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                  Number(customer.id),
                  String(customer.name || '').trim(),
                  customer.phone ?? null,
                  customer.notes ?? null,
                  customer.follow_up_status || 'active',
                  customer.last_reminded_at ?? null,
                  customer.created_at || new Date().toISOString(),
                ]
              );
            }

            for (const wallet of backup.wallets) {
              const channel = String(wallet.channel || '').trim();
              if (!channel) continue;
              await db.runAsync(
                "INSERT INTO wallets (channel, balance) VALUES (?, ?)",
                [channel, Number(wallet.balance) || 0]
              );
            }

            for (const tx of backup.transactions) {
              await db.runAsync(
                "INSERT INTO transactions (id, type, amount, fee, channel, customer_id, is_debt, deduct_fee, target_debt_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  Number(tx.id),
                  tx.type,
                  Number(tx.amount) || 0,
                  Number(tx.fee) || 0,
                  tx.channel,
                  tx.customer_id ?? null,
                  tx.is_debt ? 1 : 0,
                  tx.deduct_fee ? 1 : 0,
                  tx.target_debt_id ?? null,
                  tx.created_at || new Date().toISOString(),
                ]
              );
            }



            for (const [key, value] of Object.entries(backup.settings || {})) {
              await db.runAsync(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                [key, String(value)]
              );
            }

            await db.runAsync(
              "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
              ['debt_payment_fee_wallet_repair_v1', 'done']
            );
          });
        } finally {
          await migrateDbIfNeeded(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['debt-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      },
    });
  };

  return {
    useDashboardData,
    useCustomers,
    useDebtors,
    useDebtLedgerSummary,
    useDebtTransactionsForCustomer,
    useDebtTransactionById,
    useWallets,
    useTransactions,
    useLatestRepeatableTransaction,
    useTransactionHistory,
    useTransactionById,
    useTransactionsForDate,
    useExportData,
    useBackupData,
    useRestoreBackup,
    useAddCustomer,
    useDeleteCustomer,
    useUpdateCustomerMeta,
    useAddTransaction,
    useUpdateTransaction,
    useDeleteTransaction,
    useSettleDebt,
    useUpdateWalletBalance,
    useResetDatabase,
    useSettings,
    useUpdateSettings,
    useAddWallet,
    useDeleteWallet,
  };
}
