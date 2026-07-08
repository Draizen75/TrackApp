import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext } from 'expo-sqlite';

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
  created_at: string;
}

export interface Expense {
  id: number;
  description: string;
  amount: number;
  channel: string;
  created_at: string;
}

export interface Wallet {
  channel: string;
  balance: number;
}

export interface Debtor {
  id: number;
  name: string;
  phone: string | null;
  balance: number;
  oldest_debt_date: string | null;
}

// --- WEB MOCK DATABASE ENGINE (localStorage backed for offline preview support) ---

const channelNames: Record<string, string> = {
  GCASH: 'GCash',
  MAYA: 'Maya',
  MAYA_BUSINESS: 'Maya Biz',
  MARIBANK: 'MariBank',
  PHYSICAL_CASH: 'Cash Box',
};

const defaultWebDb = {
  customers: [
    { id: 1, name: 'Sari-Sari Store Cash', phone: '', created_at: new Date().toISOString() }
  ],
  transactions: [] as any[],
  expenses: [] as any[],
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

const getWebDb = () => {
  if (typeof window === 'undefined') return defaultWebDb;
  const data = localStorage.getItem('counter_db');
  if (!data) {
    localStorage.setItem('counter_db', JSON.stringify(defaultWebDb));
    return defaultWebDb;
  }
  try {
    const parsed = JSON.parse(data);
    return {
      customers: parsed.customers || defaultWebDb.customers,
      transactions: parsed.transactions || defaultWebDb.transactions,
      expenses: parsed.expenses || defaultWebDb.expenses,
      wallets: { ...defaultWebDb.wallets, ...(parsed.wallets || {}) },
      settings: { ...defaultWebDb.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return defaultWebDb;
  }
};

const saveWebDb = (db: any) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('counter_db', JSON.stringify(db));
  }
};

const getDashboardMetrics = (db: any) => {
  const transactions = db.transactions || [];
  const expenses = db.expenses || [];
  const walletsMap = db.wallets || {};

  const grossProfit = transactions.reduce((sum: number, tx: any) => sum + (Number(tx.fee) || 0), 0);
  const totalExpenses = expenses.reduce((sum: number, exp: any) => sum + (Number(exp.amount) || 0), 0);
  const netProfit = grossProfit - totalExpenses;

  const totalDebt = transactions.reduce((sum: number, tx: any) => {
    if (tx.is_debt) {
      const fee = tx.deduct_fee === 1 ? 0 : (Number(tx.fee) || 0);
      return sum + (Number(tx.amount) || 0) + fee;
    }
    if (tx.type === 'DEBT_PAYMENT') return sum - (Number(tx.amount) || 0);
    return sum;
  }, 0);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayProfit = transactions.reduce((sum: number, tx: any) => {
    if (tx.created_at && tx.created_at.startsWith(todayStr)) return sum + (Number(tx.fee) || 0);
    return sum;
  }, 0);

  const wallets = Object.entries(walletsMap).map(([channel, balance]) => ({
    channel,
    balance: Number(balance) || 0
  }));

  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map(tx => {
      const cust = db.customers.find((c: any) => c.id === tx.customer_id);
      return {
        ...tx,
        customer_name: cust ? cust.name : null
      };
    });

  const dailyProfits = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const displayLabel = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    const profit = transactions.reduce((sum: number, tx: any) => {
      if (tx.created_at && tx.created_at.startsWith(dateStr)) return sum + (Number(tx.fee) || 0);
      return sum;
    }, 0);
    dailyProfits.push({ date: displayLabel, profit });
  }

  return {
    grossProfit,
    totalExpenses,
    netProfit,
    totalDebt,
    todayProfit,
    wallets,
    recentTransactions,
    dailyProfits
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
    wallets[tx.channel] = (wallets[tx.channel] || 0) + amt;
  }
};

function useWebDbQueries() {
  const queryClient = useQueryClient();

  const useDashboardData = () => {
    return useQuery({
      queryKey: ['dashboard'],
      queryFn: async () => {
        const db = getWebDb();
        return getDashboardMetrics(db);
      }
    });
  };

  const useCustomers = () => {
    return useQuery({
      queryKey: ['customers'],
      queryFn: async () => {
        const db = getWebDb();
        return db.customers || [];
      }
    });
  };

  const useDebtors = () => {
    return useQuery({
      queryKey: ['debtors'],
      queryFn: async () => {
        const db = getWebDb();
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
                oldest_debt_date: null
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
        return Object.values(debtorsMap);
      }
    });
  };

  const useExpenses = () => {
    return useQuery({
      queryKey: ['expenses'],
      queryFn: async () => {
        const db = getWebDb();
        return [...(db.expenses || [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
    });
  };

  const useWallets = () => {
    return useQuery({
      queryKey: ['wallets'],
      queryFn: async () => {
        const db = getWebDb();
        return Object.entries(db.wallets || {}).map(([channel, balance]) => ({
          channel,
          balance: Number(balance) || 0
        }));
      }
    });
  };

  const useTransactions = () => {
    return useQuery({
      queryKey: ['transactions'],
      queryFn: async () => {
        const db = getWebDb();
        return [...(db.transactions || [])]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map(tx => {
            const cust = db.customers.find((c: any) => c.id === tx.customer_id);
            return {
              ...tx,
              customer_name: cust ? cust.name : null
            };
          });
      }
    });
  };

  const useAddCustomer = () => {
    return useMutation({
      mutationFn: async ({ name, phone }: { name: string; phone?: string }) => {
        const db = getWebDb();
        const existing = db.customers.find((c: any) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        const newCust = {
          id: db.customers.length + 1,
          name,
          phone: phone || '',
          created_at: new Date().toISOString()
        };
        db.customers.push(newCust);
        saveWebDb(db);
        return newCust.id;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      }
    });
  };

  const useDeleteCustomer = () => {
    return useMutation({
      mutationFn: async (id: number) => {
        const db = getWebDb();
        const idx = db.customers.findIndex((c: any) => c.id === id);
        if (idx !== -1) {
          db.customers.splice(idx, 1);
          if (db.transactions) {
            db.transactions.forEach((tx: any) => {
              if (tx.customer_id === id) {
                tx.customer_id = null;
              }
            });
          }
          saveWebDb(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useAddTransaction = () => {
    return useMutation({
      mutationFn: async (tx: {
        type: 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD' | 'DEBT_PAYMENT';
        amount: number;
        fee: number;
        channel: string;
        customer_id: number | null;
        is_debt: boolean;
        deduct_fee: boolean;
      }) => {
        const db = getWebDb();
        const newTx = {
          id: db.transactions.length + 1,
          type: tx.type,
          amount: tx.amount,
          fee: tx.fee,
          channel: tx.channel,
          customer_id: tx.customer_id,
          is_debt: tx.is_debt ? 1 : 0,
          deduct_fee: tx.deduct_fee ? 1 : 0,
          created_at: new Date().toISOString()
        };

        // Validate wallet balance will not go negative
        const testWallets = { ...db.wallets } as Record<string, number>;
        applyTxToWallets(testWallets, newTx, false);
        const negativeWallet = Object.entries(testWallets).find(([_, bal]) => bal < -0.01);
        if (negativeWallet) {
          throw new Error(`Insufficient float balance in ${channelNames[negativeWallet[0]] || negativeWallet[0]}.`);
        }

        db.transactions.push(newTx);
        applyTxToWallets(db.wallets, newTx, false);
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

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
        const db = getWebDb();
        const idx = db.transactions.findIndex((t: any) => t.id === tx.id);
        if (idx !== -1) {
          const oldTx = db.transactions[idx];

          // Dry run balances check
          const testWallets = { ...db.wallets } as Record<string, number>;
          applyTxToWallets(testWallets, oldTx, true); // Revert old

          const updatedTx = {
            ...oldTx,
            type: tx.type,
            amount: tx.amount,
            fee: tx.fee,
            channel: tx.channel,
            customer_id: tx.customer_id,
            is_debt: tx.is_debt ? 1 : 0,
            deduct_fee: tx.deduct_fee ? 1 : 0,
          };
          applyTxToWallets(testWallets, updatedTx, false); // Apply new

          const negativeWallet = Object.entries(testWallets).find(([_, bal]) => bal < -0.01);
          if (negativeWallet) {
            throw new Error(`Insufficient float balance in ${channelNames[negativeWallet[0]] || negativeWallet[0]}.`);
          }

          // Apply changes
          applyTxToWallets(db.wallets, oldTx, true);
          db.transactions[idx] = updatedTx;
          applyTxToWallets(db.wallets, updatedTx, false);
          saveWebDb(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useDeleteTransaction = () => {
    return useMutation({
      mutationFn: async (id: number) => {
        const db = getWebDb();
        const idx = db.transactions.findIndex((t: any) => t.id === id);
        if (idx !== -1) {
          const tx = db.transactions[idx];
          applyTxToWallets(db.wallets, tx, true);
          db.transactions.splice(idx, 1);
          saveWebDb(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useSettleDebt = () => {
    return useMutation({
      mutationFn: async ({ customer_id, amount, channel }: { customer_id: number; amount: number; channel: string }) => {
        const db = getWebDb();
        const newTx = {
          id: db.transactions.length + 1,
          type: 'DEBT_PAYMENT' as const,
          amount,
          fee: 0,
          channel,
          customer_id,
          is_debt: 0,
          created_at: new Date().toISOString()
        };
        db.transactions.push(newTx);
        applyTxToWallets(db.wallets, newTx, false);
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useAddExpense = () => {
    return useMutation({
      mutationFn: async (exp: { description: string; amount: number; channel: string }) => {
        const db = getWebDb();
        const currentBalance = db.wallets[exp.channel] || 0;
        if (currentBalance - exp.amount < -0.01) {
          throw new Error(`Insufficient float balance in ${channelNames[exp.channel] || exp.channel}.`);
        }
        const newExp = {
          id: db.expenses.length + 1,
          description: exp.description,
          amount: exp.amount,
          channel: exp.channel,
          created_at: new Date().toISOString()
        };
        db.expenses.push(newExp);
        db.wallets[exp.channel] = currentBalance - exp.amount;
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useDeleteExpense = () => {
    return useMutation({
      mutationFn: async (id: number) => {
        const db = getWebDb();
        const idx = db.expenses.findIndex((e: any) => e.id === id);
        if (idx !== -1) {
          const exp = db.expenses[idx];
          db.wallets[exp.channel] = (db.wallets[exp.channel] || 0) + exp.amount;
          db.expenses.splice(idx, 1);
          saveWebDb(db);
        }
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useUpdateWalletBalance = () => {
    return useMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        const db = getWebDb();
        db.wallets[channel] = balance;
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useAddWallet = () => {
    return useMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        const db = getWebDb();
        const chKey = channel.trim().toUpperCase();
        if (!chKey) throw new Error("Wallet name cannot be blank.");
        if (db.wallets[chKey] !== undefined) throw new Error("A wallet with this name already exists.");
        db.wallets[chKey] = balance;
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useDeleteWallet = () => {
    return useMutation({
      mutationFn: async (channel: string) => {
        const db = getWebDb();
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

        // Verify if any expense is associated with this wallet
        const hasExp = (db.expenses || []).some((exp: any) => exp.channel?.toUpperCase() === chKey);
        if (hasExp) {
          throw new Error(`Cannot delete wallet: ${channel} has linked expense logs.`);
        }

        if (db.wallets[chKey] !== undefined) {
          delete db.wallets[chKey];
        } else if (db.wallets[channel] !== undefined) {
          delete db.wallets[channel];
        }
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useResetDatabase = () => {
    return useMutation({
      mutationFn: async () => {
        const db = getWebDb();
        db.transactions = [];
        db.expenses = [];
        db.customers = [
          { id: 1, name: 'Sari-Sari Store Cash', phone: '', created_at: new Date().toISOString() }
        ];
        for (const k of Object.keys(db.wallets)) {
          db.wallets[k] = 0;
        }
        saveWebDb(db);
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      }
    });
  };

  const useSettings = () => {
    return useQuery({
      queryKey: ['settings'],
      queryFn: async () => {
        const db = getWebDb();
        return db.settings || defaultWebDb.settings;
      }
    });
  };

  const useUpdateSettings = () => {
    return useMutation({
      mutationFn: async (newSettings: Record<string, string>) => {
        const db = getWebDb();
        db.settings = { ...(db.settings || {}), ...newSettings };
        saveWebDb(db);
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
      queryFn: async () => {
        const db = getWebDb();
        const transactions = [...(db.transactions || [])]
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((tx: any) => {
            const cust = (db.customers || []).find((c: any) => c.id === tx.customer_id);
            return { ...tx, customer_name: cust ? cust.name : '' };
          });
        const expenses = [...(db.expenses || [])]
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { transactions, expenses };
      },
      enabled: false,
    });
  };

  return {
    useDashboardData,
    useCustomers,
    useDebtors,
    useExpenses,
    useWallets,
    useTransactions,
    useExportData,
    useAddCustomer,
    useDeleteCustomer,
    useAddTransaction,
    useUpdateTransaction,
    useDeleteTransaction,
    useSettleDebt,
    useAddExpense,
    useDeleteExpense,
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
  const useDashboardData = () => {
    return useQuery({
      queryKey: ['dashboard'],
      queryFn: async () => {
        // Gross Profit (Sum of fees)
        const profitResult = await db.getFirstAsync<{ gross_profit: number }>(
          "SELECT COALESCE(SUM(fee), 0) as gross_profit FROM transactions"
        );
        const grossProfit = profitResult?.gross_profit ?? 0;

        // Total Expenses
        const expenseResult = await db.getFirstAsync<{ total_expenses: number }>(
          "SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses"
        );
        const totalExpenses = expenseResult?.total_expenses ?? 0;

        const netProfit = grossProfit - totalExpenses;

        // Total Debtors Outstanding
        const debtResult = await db.getFirstAsync<{ total_debt: number }>(`
          SELECT 
            COALESCE(SUM(CASE WHEN t.is_debt = 1 THEN (t.amount + (CASE WHEN t.deduct_fee = 1 THEN 0 ELSE t.fee END)) ELSE 0 END), 0) - 
            COALESCE(SUM(CASE WHEN t.type = 'DEBT_PAYMENT' THEN t.amount ELSE 0 END), 0) AS total_debt
          FROM transactions t
        `);
        const totalDebt = debtResult?.total_debt ?? 0;

        // Today's Gross Profit
        const todayStr = new Date().toISOString().split('T')[0];
        const todayProfitResult = await db.getFirstAsync<{ today_profit: number }>(
          "SELECT COALESCE(SUM(fee), 0) as today_profit FROM transactions WHERE created_at LIKE ?",
          [`${todayStr}%`]
        );
        const todayProfit = todayProfitResult?.today_profit ?? 0;

        // Wallet balances
        const wallets = await db.getAllAsync<Wallet>(
          "SELECT channel, balance FROM wallets"
        );

        // Recent Transactions (limit 15)
        const recentTransactions = await db.getAllAsync<Transaction>(`
          SELECT t.*, c.name as customer_name 
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          ORDER BY t.created_at DESC
          LIMIT 10
        `);

        // Daily profits for the last 7 days
        const dailyProfits: { date: string; profit: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const result = await db.getFirstAsync<{ day_profit: number }>(
            "SELECT COALESCE(SUM(fee), 0) as day_profit FROM transactions WHERE created_at LIKE ?",
            [`${dateStr}%`]
          );
          dailyProfits.push({
            date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }),
            profit: result?.day_profit ?? 0,
          });
        }

        return {
          grossProfit,
          totalExpenses,
          netProfit,
          totalDebt,
          todayProfit,
          wallets,
          recentTransactions,
          dailyProfits,
        };
      },
    });
  };

  // 2. Customers List Query
  const useCustomers = () => {
    return useQuery({
      queryKey: ['customers'],
      queryFn: async () => {
        return await db.getAllAsync<Customer>(
          "SELECT * FROM customers ORDER BY name ASC"
        );
      },
    });
  };

  // 3. Debtors Tracker Query
  const useDebtors = () => {
    return useQuery({
      queryKey: ['debtors'],
      queryFn: async () => {
        const query = `
          SELECT 
            c.id, 
            c.name, 
            c.phone, 
            COALESCE(SUM(CASE WHEN t.is_debt = 1 THEN (t.amount + (CASE WHEN t.deduct_fee = 1 THEN 0 ELSE t.fee END)) ELSE 0 END), 0) - 
            COALESCE(SUM(CASE WHEN t.type = 'DEBT_PAYMENT' THEN t.amount ELSE 0 END), 0) AS balance,
            MIN(CASE WHEN t.is_debt = 1 THEN t.created_at ELSE NULL END) AS oldest_debt_date
          FROM customers c
          LEFT JOIN transactions t ON c.id = t.customer_id
          GROUP BY c.id
          HAVING SUM(CASE WHEN t.is_debt = 1 OR t.type = 'DEBT_PAYMENT' THEN 1 ELSE 0 END) > 0
          ORDER BY balance DESC, c.name ASC
        `;
        return await db.getAllAsync<Debtor>(query);
      },
    });
  };

  // 4. Expenses List Query
  const useExpenses = () => {
    return useQuery({
      queryKey: ['expenses'],
      queryFn: async () => {
        return await db.getAllAsync<Expense>(
          "SELECT * FROM expenses ORDER BY created_at DESC"
        );
      },
    });
  };

  // 5. Digital Wallets Query
  const useWallets = () => {
    return useQuery({
      queryKey: ['wallets'],
      queryFn: async () => {
        return await db.getAllAsync<Wallet>(
          "SELECT channel, balance FROM wallets"
        );
      },
    });
  };

  // 5.5 All Transactions Query
  const useTransactions = () => {
    return useQuery({
      queryKey: ['transactions'],
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
        await db.runAsync("DELETE FROM customers WHERE id = ?", [id]);
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
        const createdAt = new Date().toISOString();
        const isDebtInt = tx.is_debt ? 1 : 0;
        const deductFeeInt = tx.deduct_fee ? 1 : 0;
        await db.runAsync(
          "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, deduct_fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [tx.type, tx.amount, tx.fee, tx.channel, tx.customer_id, isDebtInt, deductFeeInt, createdAt]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
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
        const isDebtInt = tx.is_debt ? 1 : 0;
        const deductFeeInt = tx.deduct_fee ? 1 : 0;
        await db.runAsync(
          "UPDATE transactions SET type = ?, amount = ?, fee = ?, channel = ?, customer_id = ?, is_debt = ?, deduct_fee = ? WHERE id = ?",
          [tx.type, tx.amount, tx.fee, tx.channel, tx.customer_id, isDebtInt, deductFeeInt, tx.id]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
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
      }: {
        customer_id: number;
        amount: number;
        channel: string;
      }) => {
        const createdAt = new Date().toISOString();
        // A debt payment is recorded as a transaction of type DEBT_PAYMENT
        // It increases the float of the selected channel and decreases the customer's balance.
        await db.runAsync(
          "INSERT INTO transactions (type, amount, fee, channel, customer_id, is_debt, created_at) VALUES ('DEBT_PAYMENT', ?, 0.0, ?, ?, 0, ?)",
          [amount, channel, customer_id, createdAt]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['debtors'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      },
    });
  };

  // Add Expense Mutation
  const useAddExpense = () => {
    return useMutation({
      mutationFn: async (exp: { description: string; amount: number; channel: string }) => {
        const createdAt = new Date().toISOString();
        await db.runAsync(
          "INSERT INTO expenses (description, amount, channel, created_at) VALUES (?, ?, ?, ?)",
          [exp.description.trim(), exp.amount, exp.channel, createdAt]
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['expenses'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      },
    });
  };

  // Delete Expense Mutation
  const useDeleteExpense = () => {
    return useMutation({
      mutationFn: async (id: number) => {
        await db.runAsync("DELETE FROM expenses WHERE id = ?", [id]);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['expenses'] });
        queryClient.invalidateQueries({ queryKey: ['wallets'] });
      },
    });
  };

  // Update Wallet Float Mutation
  const useUpdateWalletBalance = () => {
    return useMutation({
      mutationFn: async ({ channel, balance }: { channel: string; balance: number }) => {
        await db.runAsync(
          "UPDATE wallets SET balance = ? WHERE channel = ?",
          [balance, channel]
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

        const existing = await db.getFirstAsync<{ channel: string }>(
          "SELECT channel FROM wallets WHERE UPPER(channel) = ?",
          [chKey]
        );
        if (existing) {
          throw new Error("A wallet with this name already exists.");
        }

        await db.runAsync(
          "INSERT INTO wallets (channel, balance) VALUES (?, ?)",
          [channel.trim(), balance]
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

        // Verify if any expense is associated with this wallet
        const expCount = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) as count FROM expenses WHERE UPPER(channel) = ?",
          [chUpper]
        );
        if (expCount && expCount.count > 0) {
          throw new Error(`Cannot delete wallet: ${channel} has linked expense logs.`);
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
        await db.execAsync("DELETE FROM transactions");
        await db.execAsync("DELETE FROM expenses");
        await db.execAsync("DELETE FROM customers");
        await db.execAsync("UPDATE wallets SET balance = 0.0");
      },
      onSuccess: () => {
        queryClient.invalidateQueries();
      },
    });
  };

  // Fetch Settings Query
  const useSettings = () => {
    return useQuery({
      queryKey: ['settings'],
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

  // Export Data Query (all transactions + expenses for CSV)
  const useExportData = () => {
    return useQuery({
      queryKey: ['export_data'],
      queryFn: async () => {
        const transactions = await db.getAllAsync<{
          id: number; type: string; amount: number; fee: number;
          channel: string; is_debt: number; created_at: string; customer_name?: string;
        }>(`
          SELECT t.*, c.name as customer_name 
          FROM transactions t
          LEFT JOIN customers c ON t.customer_id = c.id
          ORDER BY t.created_at DESC
        `);
        const expenses = await db.getAllAsync<{
          id: number; description: string; amount: number; channel: string; created_at: string;
        }>("SELECT * FROM expenses ORDER BY created_at DESC");
        return { transactions, expenses };
      },
      enabled: false,
    });
  };

  return {
    useDashboardData,
    useCustomers,
    useDebtors,
    useExpenses,
    useWallets,
    useTransactions,
    useExportData,
    useAddCustomer,
    useDeleteCustomer,
    useAddTransaction,
    useUpdateTransaction,
    useDeleteTransaction,
    useSettleDebt,
    useAddExpense,
    useDeleteExpense,
    useUpdateWalletBalance,
    useResetDatabase,
    useSettings,
    useUpdateSettings,
    useAddWallet,
    useDeleteWallet,
  };
}
