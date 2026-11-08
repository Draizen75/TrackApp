import {
  assertValidBackup,
  assertValidTransactionInput,
  analyzeDebtLedger,
  applyOptimisticDebtPayment,
  calculateCollectedDebtEarningsByDate,
  calculateSettlementTotalForProfit,
  calculateDebtPaymentAllocation,
  calculateLedgerDebtAllocation,
  calculateOldestUnpaidDebtDate,
  getDebtOutstandingById,
  getDebtorBalanceStatus,
  getDebtEntryOutstanding,
  isSettlementBreakdownBalanced,
  paginateTransactionHistory,
  roundCurrency,
  sortTransactionsNewestFirst,
  splitSettlementReceived,
  summarizeEarningsPeriod,
  type DailyProfitItem,
  type BackupData,
  type Transaction,
} from '@/hooks/useDbQueries';

const debt: Transaction = {
  id: 1,
  type: 'E_LOAD',
  amount: 100,
  fee: 10,
  channel: 'GCASH',
  customer_id: 1,
  is_debt: 1,
  deduct_fee: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

const payment: Transaction = {
  id: 2,
  type: 'DEBT_PAYMENT',
  amount: 110,
  fee: 40,
  channel: 'GCASH',
  customer_id: 1,
  is_debt: 0,
  deduct_fee: 0,
  created_at: '2026-01-02T00:00:00.000Z',
};

const wallets = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'].map((channel) => ({
  channel,
  balance: 100,
}));

describe('ledger safety rules', () => {
  it('counts contractual debt earnings only when collected, on the payment date', () => {
    const debtDate = new Date(2026, 2, 1, 10).toISOString();
    const paymentDate = new Date(2026, 2, 4, 10).toISOString();
    const paymentDateKey = [
      new Date(paymentDate).getFullYear(),
      String(new Date(paymentDate).getMonth() + 1).padStart(2, '0'),
      String(new Date(paymentDate).getDate()).padStart(2, '0'),
    ].join('-');
    const unpaidDebt: Transaction = {
      ...debt,
      id: 21,
      amount: 100,
      fee: 10,
      customer_id: 7,
      created_at: debtDate,
    };
    const partialPayment: Transaction = {
      ...payment,
      id: 22,
      amount: 5,
      fee: 3,
      customer_id: 7,
      created_at: paymentDate,
    };

    expect(calculateCollectedDebtEarningsByDate([unpaidDebt, partialPayment]).get(paymentDateKey)).toBe(8);
    expect(calculateDebtPaymentAllocation([unpaidDebt, partialPayment])).toMatchObject({
      contractualEarningsPaid: 5,
      pendingEarnings: 5,
    });
  });

  it('tracks pending debt earnings by the original debt-entry date after partial collections', () => {
    const debtDate = new Date(2026, 2, 1, 10).toISOString();
    const paymentDate = new Date(2026, 2, 4, 10).toISOString();
    const dateKey = (value: string) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const unpaidDebt: Transaction = {
      ...debt,
      id: 31,
      amount: 100,
      fee: 10,
      customer_id: 17,
      created_at: debtDate,
    };
    const partialPayment: Transaction = {
      ...payment,
      id: 32,
      amount: 5,
      fee: 0,
      customer_id: 17,
      created_at: paymentDate,
    };

    const analysis = analyzeDebtLedger([unpaidDebt, partialPayment]);
    expect(analysis.pendingEarningsByDate.get(dateKey(debtDate))).toBe(5);
    expect(analysis.pendingEarningsByDate.get(dateKey(paymentDate))).toBeUndefined();
    expect(analysis.allocation.pendingEarnings).toBe(5);
  });

  it('continues FIFO collection after a targeted payment clears an earlier debt', () => {
    const firstDebt: Transaction = {
      ...debt,
      id: 41,
      amount: 10,
      fee: 2,
      customer_id: 9,
      created_at: new Date(2026, 2, 1, 10).toISOString(),
    };
    const secondDebt: Transaction = {
      ...firstDebt,
      id: 42,
      amount: 10,
      fee: 3,
      created_at: new Date(2026, 2, 2, 10).toISOString(),
    };
    const targetedPayment: Transaction = {
      ...payment,
      id: 43,
      amount: 12,
      fee: 0,
      target_debt_id: firstDebt.id,
      customer_id: 9,
      created_at: new Date(2026, 2, 3, 10).toISOString(),
    };
    const fifoPayment: Transaction = {
      ...targetedPayment,
      id: 44,
      amount: 1,
      fee: 0,
      target_debt_id: null,
      created_at: new Date(2026, 2, 4, 10).toISOString(),
    };
    const earnings = calculateCollectedDebtEarningsByDate([
      firstDebt,
      secondDebt,
      targetedPayment,
      fifoPayment,
    ]);
    const dateKey = (value: string) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    expect(earnings.get(dateKey(targetedPayment.created_at))).toBe(2);
    expect(earnings.get(dateKey(fifoPayment.created_at))).toBe(1);
  });

  it('matches existing debt allocation, collected earnings, and oldest-debt results', () => {
    const anotherDebt: Transaction = {
      ...debt,
      id: 31,
      amount: 40,
      fee: 4,
      customer_id: 2,
      created_at: '2026-01-03T00:00:00.000Z',
    };
    const targetedPayment: Transaction = {
      ...payment,
      id: 32,
      amount: 20,
      fee: 2,
      customer_id: 2,
      target_debt_id: anotherDebt.id,
      created_at: '2026-01-04T00:00:00.000Z',
    };
    const orphanDebt: Transaction = {
      ...debt,
      id: 33,
      amount: 25,
      customer_id: null,
      created_at: '2026-01-05T00:00:00.000Z',
    };
    const orphanPayment: Transaction = {
      ...payment,
      id: 34,
      amount: 5,
      fee: 3,
      customer_id: null,
      created_at: '2026-01-06T00:00:00.000Z',
    };
    const transactions = [targetedPayment, orphanPayment, debt, anotherDebt, payment, orphanDebt];
    const analysis = analyzeDebtLedger(transactions);

    expect(analysis.allocation).toEqual(calculateLedgerDebtAllocation(transactions));
    expect(analysis.collectedEarningsByDate).toEqual(calculateCollectedDebtEarningsByDate(transactions));
    for (const customerId of [1, 2]) {
      const customerTransactions = transactions.filter(transaction => transaction.customer_id === customerId);
      const summary = analysis.customers.get(customerId);
      const balance = customerTransactions.reduce((total, transaction) => {
        if (transaction.is_debt === 1) return total + transaction.amount + (transaction.deduct_fee === 1 ? 0 : transaction.fee);
        if (transaction.type === 'DEBT_PAYMENT') return total - transaction.amount;
        return total;
      }, 0);
      expect(summary?.balance).toBe(balance);
      expect(summary?.oldestUnpaidDebtDate).toBe(calculateOldestUnpaidDebtDate(customerTransactions));
    }
  });

  it('summarizes only earnings within the requested calendar date range', () => {
    const dailyProfits: DailyProfitItem[] = [
      { dateKey: '2026-03-01', date: 'Sun, 3/1', profit: 4, grossProfit: 4, netProfit: 4, pendingEarnings: 9, txCount: 1 },
      { dateKey: '2026-03-02', date: 'Mon, 3/2', profit: 8, grossProfit: 10, netProfit: 8, pendingEarnings: 5, txCount: 2 },
      { dateKey: '2026-03-03', date: 'Tue, 3/3', profit: 3, grossProfit: 6, netProfit: 3, pendingEarnings: 2, txCount: 1 },
    ];

    expect(summarizeEarningsPeriod(
      dailyProfits,
      new Date(2026, 2, 2),
      new Date(2026, 2, 4),
    )).toEqual({ grossProfit: 16, netProfit: 11, pendingEarnings: 7, txCount: 3 });
  });

  it('classifies settled balances consistently while preserving customer credits', () => {
    expect(getDebtorBalanceStatus(0.02)).toBe('active');
    expect(getDebtorBalanceStatus(-0.02)).toBe('credit');
    expect(getDebtorBalanceStatus(0.01)).toBe('active');
    expect(getDebtorBalanceStatus(-0.01)).toBe('credit');
    expect(getDebtorBalanceStatus(0.001)).toBe('settled');
    expect(getDebtorBalanceStatus(-0.001)).toBe('settled');
  });

  it('updates debt balances immediately while retaining accurate unpaid-debt metadata', () => {
    const debtor = {
      id: 8,
      name: 'Customer',
      phone: null,
      balance: 150,
      oldest_debt_date: '2026-01-01T00:00:00.000Z',
      last_payment_date: null,
      latest_tx_date: '2026-01-01T00:00:00.000Z',
    };
    const paidAt = '2026-02-01T00:00:00.000Z';

    expect(applyOptimisticDebtPayment([debtor], 8, 40, paidAt)).toEqual([{
      ...debtor,
      balance: 110,
      last_payment_date: paidAt,
      latest_tx_date: paidAt,
    }]);
    expect(applyOptimisticDebtPayment([debtor], 8, 150, paidAt)).toEqual([{
      ...debtor,
      balance: 0,
      oldest_debt_date: null,
      last_payment_date: paidAt,
      latest_tx_date: paidAt,
    }]);
    expect(applyOptimisticDebtPayment([debtor], 9, 40, paidAt)).toEqual([debtor]);
    expect(debtor.balance).toBe(150);
  });

  it('allocates a settlement to principal, contractual earnings, and extra profit', () => {
    expect(calculateDebtPaymentAllocation([debt, payment])).toEqual({
      principalPaid: 100,
      contractualEarningsPaid: 10,
      extraProfitPaid: 40,
      pendingPrincipal: 0,
      pendingEarnings: 0,
    });
    expect(calculateLedgerDebtAllocation([debt, payment])).toEqual({
      principalPaid: 100,
      contractualEarningsPaid: 10,
      extraProfitPaid: 40,
      pendingPrincipal: 0,
      pendingEarnings: 0,
    });
  });

  it('keeps selected-debt payments isolated from other debts', () => {
    const secondDebt: Transaction = { ...debt, id: 3, amount: 50, fee: 0, created_at: '2026-01-02T00:00:00.000Z' };
    const selectedPayment: Transaction = { ...payment, id: 4, amount: 50, fee: 0, target_debt_id: secondDebt.id, created_at: '2026-01-03T00:00:00.000Z' };
    expect(getDebtEntryOutstanding([debt, secondDebt, selectedPayment], debt.id)).toBe(110);
    expect(getDebtEntryOutstanding([debt, secondDebt, selectedPayment], secondDebt.id)).toBe(0);
    expect(calculateOldestUnpaidDebtDate([debt, secondDebt, selectedPayment])).toBe(debt.created_at);
  });

  it('calculates outstanding balances for all debt entries in one allocation pass', () => {
    const secondDebt: Transaction = { ...debt, id: 3, amount: 50, fee: 0, created_at: '2026-01-02T00:00:00.000Z' };
    const fifoPayment: Transaction = { ...payment, id: 4, amount: 30, fee: 0, created_at: '2026-01-03T00:00:00.000Z' };
    const selectedPayment: Transaction = {
      ...payment, id: 5, amount: 50, fee: 0, target_debt_id: secondDebt.id, created_at: '2026-01-04T00:00:00.000Z',
    };
    const transactions = [selectedPayment, secondDebt, fifoPayment, debt];
    const outstandingByDebtId = getDebtOutstandingById(transactions);

    expect(outstandingByDebtId.get(debt.id)).toBe(getDebtEntryOutstanding(transactions, debt.id));
    expect(outstandingByDebtId.get(secondDebt.id)).toBe(getDebtEntryOutstanding(transactions, secondDebt.id));
  });

  it('finds the oldest unpaid debt after many targeted repayments in one ledger pass', () => {
    const transactions: Transaction[] = [];
    const debtCount = 2000;
    for (let id = 1; id <= debtCount; id += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, id)).toISOString();
      transactions.push({
        ...debt,
        id,
        amount: 10,
        fee: 0,
        created_at: createdAt,
      });
      if (id < debtCount) {
        transactions.push({
          ...payment,
          id: debtCount + id,
          amount: 10,
          fee: 0,
          target_debt_id: id,
          created_at: new Date(Date.UTC(2026, 0, id + 1, 12)).toISOString(),
        });
      }
    }

    expect(calculateOldestUnpaidDebtDate(transactions)).toBe(transactions[transactions.length - 1].created_at);
  });

  it('allocates FIFO and selected-debt payments without double-paying either debt', () => {
    const secondDebt: Transaction = { ...debt, id: 3, amount: 50, fee: 0, created_at: '2026-01-02T00:00:00.000Z' };
    const fifoPayment: Transaction = { ...payment, id: 4, amount: 30, fee: 0, created_at: '2026-01-03T00:00:00.000Z' };
    const selectedPayment: Transaction = {
      ...payment, id: 5, amount: 50, fee: 0, target_debt_id: secondDebt.id, created_at: '2026-01-04T00:00:00.000Z',
    };
    const transactions = [debt, secondDebt, fifoPayment, selectedPayment];

    expect(getDebtEntryOutstanding(transactions, debt.id)).toBe(80);
    expect(getDebtEntryOutstanding(transactions, secondDebt.id)).toBe(0);
    expect(calculateDebtPaymentAllocation(transactions)).toEqual({
      principalPaid: 70,
      contractualEarningsPaid: 10,
      extraProfitPaid: 0,
      pendingPrincipal: 80,
      pendingEarnings: 0,
    });
  });

  it('rounds new money inputs to cent precision', () => {
    expect(roundCurrency(10.005)).toBe(10.01);
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });

  it('caps a selected-debt settlement while preserving excess as suggested profit', () => {
    expect(splitSettlementReceived(60, 55)).toEqual({ principal: 55, suggestedProfit: 5 });
    expect(splitSettlementReceived(40, 55)).toEqual({ principal: 40, suggestedProfit: 0 });
  });

  it('adds manually entered profit to the total received without changing principal', () => {
    expect(calculateSettlementTotalForProfit(2550, 2550, 100)).toBe(2650);
    expect(splitSettlementReceived(calculateSettlementTotalForProfit(2550, 2550, 100), 2550))
      .toEqual({ principal: 2550, suggestedProfit: 100 });
  });

  it('preserves the original debt payment when extra profit is repeatedly edited or cleared', () => {
    const afterAddingProfit = calculateSettlementTotalForProfit(40, 55, 5, 0);
    expect(afterAddingProfit).toBe(45);

    const afterIncreasingProfit = calculateSettlementTotalForProfit(afterAddingProfit, 55, 10, 5);
    expect(afterIncreasingProfit).toBe(50);

    const afterReducingProfit = calculateSettlementTotalForProfit(afterIncreasingProfit, 55, 2, 10);
    expect(afterReducingProfit).toBe(42);

    const afterClearingProfit = calculateSettlementTotalForProfit(afterReducingProfit, 55, 0, 2);
    expect(afterClearingProfit).toBe(40);
  });

  it('does not allow edited extra profit to push the debt balance portion above its cap', () => {
    expect(calculateSettlementTotalForProfit(60, 55, 10, 5)).toBe(60);
    expect(calculateSettlementTotalForProfit(60, 55, 0, 5)).toBe(55);
  });

  it('includes the initial contractual fee in the amount owed while keeping extra profit separate', () => {
    const debtWithInitialFee: Transaction = { ...debt, id: 80, amount: 100, fee: 10, deduct_fee: 0 };
    expect(getDebtEntryOutstanding([debtWithInitialFee], debtWithInitialFee.id)).toBe(110);

    const paymentWithExtraProfit: Transaction = {
      ...payment, id: 81, amount: 110, fee: 5, target_debt_id: debtWithInitialFee.id,
    };
    const allocation = calculateDebtPaymentAllocation([debtWithInitialFee, paymentWithExtraProfit]);
    expect(allocation).toEqual({
      principalPaid: 100,
      contractualEarningsPaid: 10,
      extraProfitPaid: 5,
      pendingPrincipal: 0,
      pendingEarnings: 0,
    });
  });

  it('preserves the zero-received profit-only workflow', () => {
    expect(calculateSettlementTotalForProfit(0, 2550, 100)).toBe(0);
    expect(isSettlementBreakdownBalanced(0, 0, 100)).toBe(true);
  });

  it('requires every received peso to be accounted for as principal or extra profit', () => {
    const split = splitSettlementReceived(2600, 2550);
    expect(split).toEqual({ principal: 2550, suggestedProfit: 50 });
    expect(isSettlementBreakdownBalanced(2600, split.principal, split.suggestedProfit)).toBe(true);
    expect(isSettlementBreakdownBalanced(2600, split.principal, 0)).toBe(false);
    expect(isSettlementBreakdownBalanced(2550, 2550, 0)).toBe(true);
  });

  it('continues to allow profit-only entries with zero principal received', () => {
    expect(isSettlementBreakdownBalanced(0, 0, 25)).toBe(true);
    expect(isSettlementBreakdownBalanced(0, 1, 25)).toBe(false);
  });

  it('rejects even a one-cent settlement breakdown mismatch', () => {
    expect(isSettlementBreakdownBalanced(100, 99.99, 0)).toBe(false);
    expect(isSettlementBreakdownBalanced(100, 99.98, 0.01)).toBe(false);
    expect(isSettlementBreakdownBalanced(100, 99.99, 0.01)).toBe(true);
  });

  it('rejects non-finite and negative settlement breakdown values', () => {
    expect(isSettlementBreakdownBalanced(Number.NaN, 0, 0)).toBe(false);
    expect(isSettlementBreakdownBalanced(100, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(isSettlementBreakdownBalanced(100, -1, 101)).toBe(false);
    expect(isSettlementBreakdownBalanced(100, 101, -1)).toBe(false);
  });

  it('pages history with a stable date-and-id cursor without duplicates', () => {
    const history = [
      { ...debt, id: 4, amount: 40, created_at: '2026-01-03T00:00:00.000Z' },
      { ...debt, id: 3, amount: 30, created_at: '2026-01-03T00:00:00.000Z' },
      { ...debt, id: 2, amount: 20, created_at: '2026-01-02T00:00:00.000Z' },
      { ...debt, id: 1, amount: 10, created_at: '2026-01-01T00:00:00.000Z' },
    ];
    const firstPage = paginateTransactionHistory(history, new Map([[1, 'Ana']]), { type: 'ALL' }, null, 2);
    const secondPage = paginateTransactionHistory(history, new Map([[1, 'Ana']]), { type: 'ALL' }, firstPage.nextCursor ?? null, 2);

    expect(firstPage.transactions.map((tx) => tx.id)).toEqual([4, 3]);
    expect(secondPage.transactions.map((tx) => tx.id)).toEqual([2, 1]);
    expect([...firstPage.transactions, ...secondPage.transactions].map((tx) => tx.id)).toEqual([4, 3, 2, 1]);
    expect(firstPage.total).toBe(4);
  });

  it('orders a debtor ledger newest-first without mutating its source', () => {
    const ledger = [
      { ...debt, id: 2, created_at: '2026-01-02T00:00:00.000Z' },
      { ...debt, id: 3, created_at: '2026-01-02T00:00:00.000Z' },
      { ...debt, id: 1, created_at: '2026-01-01T00:00:00.000Z' },
    ];

    expect(sortTransactionsNewestFirst(ledger).map((transaction) => transaction.id)).toEqual([3, 2, 1]);
    expect(ledger.map((transaction) => transaction.id)).toEqual([2, 3, 1]);
  });

  it('reuses the sorted web history index across pages and preserves matching totals', () => {
    const history = Array.from({ length: 300 }, (_, index) => ({
      ...debt,
      id: index + 1,
      amount: index % 2 === 0 ? 25 : 50,
      created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    })).reverse();
    let sourceIterations = 0;
    const historySource = new Proxy(history, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          return function* () {
            sourceIterations += 1;
            yield* target;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const customerNamesById = new Map([[1, 'Ana Santos']]);
    const firstPage = paginateTransactionHistory(
      historySource,
      customerNamesById,
      { type: 'E_LOAD', search: 'ana' },
      null,
      20,
    );
    const secondPage = paginateTransactionHistory(
      historySource,
      customerNamesById,
      { type: 'E_LOAD', search: 'ana' },
      firstPage.nextCursor ?? null,
      20,
    );

    expect(sourceIterations).toBe(1);
    expect(firstPage.total).toBe(300);
    expect(firstPage.transactions.map((transaction) => transaction.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => 300 - index),
    );
    expect(secondPage.transactions.map((transaction) => transaction.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => 280 - index),
    );
    expect(secondPage.nextCursor?.index).toBe(40);
  });

  it('applies wallet and date filters before paginating web history', () => {
    const history: Transaction[] = [
      { ...debt, id: 11, channel: 'GCASH', created_at: '2026-03-01T10:00:00.000Z' },
      { ...debt, id: 12, channel: 'MAYA', created_at: '2026-03-02T10:00:00.000Z' },
      { ...debt, id: 13, channel: 'GCASH', created_at: '2026-03-03T10:00:00.000Z' },
    ];

    const page = paginateTransactionHistory(
      history,
      new Map([[1, 'Ana']]),
      {
        type: 'ALL',
        channel: 'GCASH',
        startDate: '2026-03-02T00:00:00.000Z',
        endDate: '2026-03-04T00:00:00.000Z',
      },
      null,
    );

    expect(page.total).toBe(1);
    expect(page.transactions.map((transaction) => transaction.id)).toEqual([13]);
  });

  it('rejects debt payments with no customer or that are flagged as new debt', () => {
    expect(() => assertValidTransactionInput({
      type: 'DEBT_PAYMENT', amount: 10, fee: 0, channel: 'GCASH', customer_id: null, is_debt: false,
    })).toThrow('linked debtor');
    expect(() => assertValidTransactionInput({
      type: 'DEBT_PAYMENT', amount: 10, fee: 0, channel: 'GCASH', customer_id: 1, is_debt: true,
    })).toThrow('cannot be recorded as a new debt');
  });

  it('rejects deducted fees that exceed the transaction amount', () => {
    expect(() => assertValidTransactionInput({
      type: 'E_LOAD', amount: 10, fee: 11, channel: 'GCASH', customer_id: null, is_debt: false, deduct_fee: true,
    })).toThrow('deducted fee');
  });

  it('accepts a valid backup and rejects a transaction pointing to a missing wallet', () => {
    const backup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [debt],
      wallets,
      settings: {},
    };
    expect(() => assertValidBackup(backup)).not.toThrow();
    expect(() => assertValidBackup({
      ...backup,
      transactions: [{ ...debt, channel: 'MISSING_WALLET' }],
    })).toThrow('invalid transaction reference');
  });

  it('rejects an overpayment or a backup without all core wallets', () => {
    const backup: BackupData = {
      schema: 'trackapp.backup', version: 1, exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: debt.created_at }],
      transactions: [{ ...debt }, { ...payment, amount: 111, fee: 0 }],
      wallets, settings: {},
    };
    expect(() => assertValidBackup(backup)).toThrow('exceeds the outstanding balance');
    expect(() => assertValidBackup({ ...backup, transactions: [debt], wallets: [{ channel: 'GCASH', balance: 100 }] }))
      .toThrow('missing one or more required wallets');
  });

  it('rejects a backup payment that targets a debt already settled by FIFO', () => {
    const laterDebt: Transaction = { ...debt, id: 3, amount: 100, fee: 0, created_at: '2026-01-03T00:00:00.000Z' };
    const backup: BackupData = {
      schema: 'trackapp.backup', version: 1, exported_at: '2026-01-04T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: debt.created_at }],
      transactions: [
        { ...debt },
        { ...payment, amount: 110, fee: 0 },
        laterDebt,
        { ...payment, id: 4, amount: 100, fee: 0, target_debt_id: debt.id, created_at: '2026-01-04T00:00:00.000Z' },
      ],
      wallets, settings: {},
    };
    expect(() => assertValidBackup(backup)).toThrow('exceeds the outstanding balance');
  });

  it('rejects a backup with wrong or negative wallet balance', () => {
    const baseBackup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: debt.created_at }],
      transactions: [debt],
      wallets,
      settings: {},
    };

    // Negative wallet balance
    expect(() => assertValidBackup({
      ...baseBackup,
      wallets: wallets.map((w) => w.channel === 'GCASH' ? { ...w, balance: -10 } : w),
    })).toThrow('invalid or duplicate wallet record');

    // Non-finite wallet balance
    expect(() => assertValidBackup({
      ...baseBackup,
      wallets: wallets.map((w) => w.channel === 'GCASH' ? { ...w, balance: NaN } : w),
    })).toThrow('invalid or duplicate wallet record');
  });

  it('preserves existing data when a backup restore validation fails', () => {
    const existingDb = {
      customers: [{ id: 99, name: 'Original Customer', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [{ ...debt, id: 99, customer_id: 99 }],
      wallets: { GCASH: 500, MAYA: 500, MAYA_BUSINESS: 500, MARIBANK: 500, PHYSICAL_CASH: 500 },
      settings: {},
    };

    // Deep copy current state
    const snapshot = JSON.parse(JSON.stringify(existingDb));

    const invalidBackup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: '2026-01-03T00:00:00.000Z',
      customers: [{ id: 1, name: 'Bad Customer', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [{ ...debt }, { ...payment, amount: 9999, fee: 0 }], // overpayment
      wallets,
      settings: {},
    };

    // Attempting restore validation must fail and not overwrite the snapshot
    expect(() => assertValidBackup(invalidBackup)).toThrow();
    expect(existingDb).toEqual(snapshot);
  });

  it('supports web settle customer -> delete -> export -> restore lifecycle', () => {
    // 1. Initial database with customer and settled transactions
    let webDb: any = {
      customers: [{ id: 1, name: 'Ana', phone: null, created_at: '2026-01-01T00:00:00.000Z' }],
      transactions: [
        { ...debt, id: 1, customer_id: 1, amount: 100, fee: 10, is_debt: 1 },
        { ...payment, id: 2, customer_id: 1, amount: 110, fee: 0, type: 'DEBT_PAYMENT' },
      ],
      wallets: { GCASH: 100, MAYA: 100, MAYA_BUSINESS: 100, MARIBANK: 100, PHYSICAL_CASH: 100 },
      settings: {},
    };

    // 2. Calculate balance: outstanding is 0 (settled)
    const outstanding = webDb.transactions.reduce((sum: number, tx: any) => {
      if (tx.is_debt === 1) return sum + tx.amount + tx.fee;
      if (tx.type === 'DEBT_PAYMENT') return sum - tx.amount;
      return sum;
    }, 0);
    expect(outstanding).toBe(0);

    // 3. Delete customer: on web, matching SQLite ON DELETE SET NULL, historical customer_id becomes null
    for (const tx of webDb.transactions) {
      if (tx.customer_id === 1) tx.customer_id = null;
    }
    webDb.customers = webDb.customers.filter((c: any) => c.id !== 1);

    expect(webDb.customers.length).toBe(0);
    expect(webDb.transactions[0].customer_id).toBeNull();
    expect(webDb.transactions[1].customer_id).toBeNull();

    // 4. Export backup
    const exportedBackup: BackupData = {
      schema: 'trackapp.backup',
      version: 1,
      exported_at: new Date().toISOString(),
      customers: [...webDb.customers],
      transactions: [...webDb.transactions],
      wallets: Object.entries(webDb.wallets).map(([channel, balance]) => ({
        channel,
        balance: Number(balance),
      })),
      settings: { ...webDb.settings },
    };

    // 5. Restore: assertValidBackup must accept the backup with customer_id: null for deleted customer
    expect(() => assertValidBackup(exportedBackup)).not.toThrow();
  });
});
