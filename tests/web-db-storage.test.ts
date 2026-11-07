let mockQueryOptions: Record<string, unknown> | undefined;
let mockMutationOptions: Record<string, unknown> | undefined;
let mockQueryCache = new Map<string, unknown>();

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    fetchQuery: async (options: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
      const key = JSON.stringify(options.queryKey);
      if (mockQueryCache.has(key)) return mockQueryCache.get(key);
      const result = await options.queryFn();
      mockQueryCache.set(key, result);
      return result;
    },
  }),
  useQuery: (options: Record<string, unknown>) => {
    mockQueryOptions = options;
    return options;
  },
  useInfiniteQuery: (options: Record<string, unknown>) => {
    mockQueryOptions = options;
    return options;
  },
  useMutation: (options: Record<string, unknown>) => {
    mockMutationOptions = options;
    return options;
  },
}));

import { useWebDbQueries, type Customer } from '@/hooks/useDbQueries';

type FakeRecord = { key: string; value: unknown };

function createFakeIndexedDb() {
  const records = new Map<string, FakeRecord>();
  let hasStore = false;
  const database = {
    objectStoreNames: { contains: () => hasStore },
    createObjectStore: () => {
      hasStore = true;
      return {};
    },
    transaction: () => {
      const transaction: {
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
        objectStore: () => {
          get: (key: string) => { result?: FakeRecord; onsuccess?: () => void; onerror?: () => void };
          put: (record: FakeRecord) => void;
        };
      } = {
        objectStore: () => ({
          get: (key) => {
            const request: { result?: FakeRecord; onsuccess?: () => void; onerror?: () => void } = {};
            queueMicrotask(() => {
              request.result = records.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          put: (record) => {
            records.set(record.key, record);
            queueMicrotask(() => transaction.oncomplete?.());
          },
        }),
      };
      return transaction;
    },
  };
  const indexedDB = {
    open: () => {
      const request: {
        result?: typeof database;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
        onerror?: () => void;
        onblocked?: () => void;
      } = {};
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return { indexedDB, records };
}

describe('web ledger IndexedDB migration', () => {
  beforeEach(() => mockQueryCache.clear());
  it('migrates the existing localStorage ledger and persists later mutations asynchronously', async () => {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const lastSunday = new Date(monday);
    lastSunday.setDate(lastSunday.getDate() - 1);
    lastSunday.setHours(12, 0, 0, 0);
    const isLastSundayInCurrentMonth = lastSunday.getMonth() === now.getMonth();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const localStorageValues = new Map<string, string>();
    let lockQueue = Promise.resolve();
    const navigator = {
      locks: {
        request: (_name: string, callback: () => Promise<unknown>) => {
          const result = lockQueue.then(callback);
          lockQueue = result.then(() => undefined, () => undefined);
          return result;
        },
      },
    };
    const legacyDatabase = {
      customers: [{ id: 2, name: 'Existing customer', phone: '', created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [
        ...Array.from({ length: 11 }, (_, index) => ({
          id: index + 1,
          type: 'E_LOAD',
          amount: 10,
          fee: 1,
          channel: 'GCASH',
          customer_id: null,
          is_debt: 0,
          deduct_fee: 0,
          created_at: new Date().toISOString(),
        })),
        {
          id: 12,
          type: 'E_LOAD',
          amount: 100,
          fee: 10,
          channel: 'GCASH',
          customer_id: 2,
          is_debt: 1,
          deduct_fee: 0,
          created_at: new Date().toISOString(),
        },
        {
          id: 13,
          type: 'DEBT_PAYMENT',
          amount: 5,
          fee: 3,
          channel: 'GCASH',
          customer_id: 2,
          is_debt: 0,
          deduct_fee: 0,
          created_at: new Date().toISOString(),
        },
        {
          id: 14,
          type: 'E_LOAD',
          amount: 10,
          fee: 2,
          channel: 'GCASH',
          customer_id: null,
          is_debt: 0,
          deduct_fee: 0,
          created_at: lastSunday.toISOString(),
        },
      ],
      wallets: { GCASH: 0, MAYA: 0, MAYA_BUSINESS: 0, MARIBANK: 0, PHYSICAL_CASH: 0 },
      settings: { debt_payment_customer_repair_v1: 'done' },
    };
    const legacyData = JSON.stringify(legacyDatabase);
    localStorageValues.set('counter_db', legacyData);
    const localStorage = {
      getItem: (key: string) => localStorageValues.get(key) ?? null,
      setItem: (key: string, value: string) => localStorageValues.set(key, value),
    };
    const fakeIndexedDb = createFakeIndexedDb();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { indexedDB: fakeIndexedDb.indexedDB },
    });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
    Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });

    try {
      const queries = useWebDbQueries();
      queries.useCustomers();
      const readCustomers = mockQueryOptions?.queryFn as () => Promise<Customer[]>;
      await expect(readCustomers()).resolves.toEqual(legacyDatabase.customers);
      expect(localStorageValues.get('counter_db_storage_version')).toBe('indexeddb_v1');

      queries.useLatestRepeatableTransaction();
      const readLatestRepeatable = mockQueryOptions?.queryFn as () => Promise<{
        id: number;
        type: string;
        customer_name: string | null;
      } | null>;
      await expect(readLatestRepeatable()).resolves.toMatchObject({
        id: 12,
        type: 'E_LOAD',
        customer_name: 'Existing customer',
      });

      queries.useAddCustomer();
      const addCustomer = mockMutationOptions?.mutationFn as (input: { name: string }) => Promise<number>;
      await addCustomer({ name: 'New customer' });

      queries.useUpdateCustomerMeta();
      const updateCustomerMeta = mockMutationOptions?.mutationFn as (input: { id: number; phone?: string | null }) => Promise<void>;
      await updateCustomerMeta({ id: 2, phone: '+1 555 0100' });
      queries.useDashboardData();
      const readDashboard = mockQueryOptions?.queryFn as () => Promise<{
        transactionCount: number;
        grossProfit: number;
        earningsPaid: number;
        totalDebt: number;
        recentTransactions: unknown[];
        dailyProfits: { netProfit: number }[];
        earningsSummary: { week: { netProfit: number }; month: { netProfit: number } };
      }>;
      const dashboard = await readDashboard();
      expect(dashboard.transactionCount).toBe(14);
      expect(dashboard.grossProfit).toBe(26);
      expect(dashboard.earningsPaid).toBe(21);
      expect(dashboard.totalDebt).toBe(105);
      expect(dashboard.dailyProfits.at(-1)?.netProfit).toBe(19);
      expect(dashboard.earningsSummary.week.netProfit).toBe(19);
      expect(dashboard.earningsSummary.month.netProfit).toBe(isLastSundayInCurrentMonth ? 21 : 19);
      expect(dashboard.recentTransactions).toHaveLength(10);

      const persisted = fakeIndexedDb.records.get('counter_db')?.value as typeof legacyDatabase;
      expect(persisted.customers.map((customer) => customer.name)).toEqual([
        'Existing customer',
        'New customer',
      ]);
      expect(persisted.customers[0].phone).toBe('+1 555 0100');
      expect(localStorageValues.get('counter_db')).toBe(legacyData);

      queries.useUpdateWalletBalance();
      const updateWalletBalance = mockMutationOptions?.mutationFn as (input: { channel: string; balance: number }) => Promise<void>;
      await updateWalletBalance({ channel: 'GCASH', balance: 1000 });

      queries.useAddTransaction();
      const addTransaction = mockMutationOptions?.mutationFn as (input: {
        type: 'E_LOAD' | 'DEBT_PAYMENT';
        amount: number;
        fee: number;
        channel: string;
        customer_id: number | null;
        is_debt: boolean;
        deduct_fee: boolean;
      }) => Promise<void>;
      const concurrentEntry = {
        type: 'E_LOAD' as const,
        amount: 100,
        fee: 1,
        channel: 'GCASH',
        customer_id: null,
        is_debt: false,
        deduct_fee: false,
      };
      await updateWalletBalance({ channel: 'GCASH', balance: 0.01 });
      await expect(addTransaction({
        ...concurrentEntry,
        amount: 0.02,
        fee: 0,
      })).rejects.toThrow('Insufficient float balance');
      await updateWalletBalance({ channel: 'GCASH', balance: 1000 });
      await Promise.all([addTransaction(concurrentEntry), addTransaction(concurrentEntry)]);

      const latestPersisted = fakeIndexedDb.records.get('counter_db')?.value as typeof legacyDatabase;
      expect(latestPersisted.transactions).toHaveLength(16);
      expect(latestPersisted.transactions.slice(-2).map((transaction) => transaction.amount)).toEqual([100, 100]);
      expect(latestPersisted.wallets.GCASH).toBe(800);
      expect(latestPersisted.wallets.PHYSICAL_CASH).toBe(202);

      await expect(addTransaction({
        ...concurrentEntry,
        type: 'DEBT_PAYMENT',
        amount: 105.01,
        fee: 0,
        customer_id: 2,
      })).rejects.toThrow('Debt payment cannot exceed the outstanding balance of 105.00.');

      await addTransaction({
        ...concurrentEntry,
        type: 'DEBT_PAYMENT',
        amount: 105,
        fee: 0,
        customer_id: 2,
      });

      queries.useDeleteCustomer();
      const deleteCustomer = mockMutationOptions?.mutationFn as (id: number) => Promise<void>;
      await expect(deleteCustomer(2)).rejects.toThrow('Cannot delete a customer with transaction history');

      const finalPersisted = fakeIndexedDb.records.get('counter_db')?.value as typeof legacyDatabase;
      expect(finalPersisted.transactions).toHaveLength(17);
      expect(finalPersisted.wallets.GCASH).toBe(905);
      expect(finalPersisted.transactions.filter((transaction) => transaction.customer_id === 2)).toHaveLength(3);

      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
      await expect(updateWalletBalance({ channel: 'GCASH', balance: 900 }))
        .rejects.toThrow('cannot safely coordinate writes across tabs');
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      if (originalBroadcastChannel) Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
      else Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
});
