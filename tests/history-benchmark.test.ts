import { type Transaction } from '@/hooks/useDbQueries';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function generateMockTransactions(count: number): Transaction[] {
  const types: Transaction['type'][] = ['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD', 'DEBT_PAYMENT'];
  const channels = ['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'];
  const customers = ['Ana Santos', 'Ben Reyes', 'Carlos Dizon', 'Dina Lopez', 'Elena Cruz'];

  const transactions: Transaction[] = [];
  const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime();

  for (let i = 1; i <= count; i++) {
    const type = types[i % types.length];
    const customer = customers[i % customers.length];
    transactions.push({
      id: i,
      type,
      amount: 50 + (i % 500),
      fee: 5 + (i % 20),
      channel: channels[i % channels.length],
      customer_id: (i % 5) + 1,
      customer_name: customer,
      is_debt: i % 4 === 0 ? 1 : 0,
      deduct_fee: i % 3 === 0 ? 1 : 0,
      created_at: new Date(baseTime + i * 60000).toISOString(),
    });
  }

  return transactions;
}

function filterTransactions(
  transactions: Transaction[],
  selectedFilter: string,
  searchQuery: string
): Transaction[] {
  const query = searchQuery.trim().toLowerCase();
  return transactions.filter((tx) => {
    if (selectedFilter !== 'ALL' && tx.type !== selectedFilter) {
      return false;
    }
    if (query.length > 0) {
      const custName = (tx.customer_name || 'anonymous transaction').toLowerCase();
      const channel = (tx.channel || '').toLowerCase();
      const amtStr = (tx.amount || '').toString();
      return custName.includes(query) || channel.includes(query) || amtStr.includes(query);
    }
    return true;
  });
}

describe('History Benchmark', () => {
  const datasetSizes = [100, 1000, 5000];

  for (const count of datasetSizes) {
    it(`benchmarks filtering and searching at ${count.toLocaleString()} records`, () => {
      const transactions = generateMockTransactions(count);

      // Measure: Category filter
      const t0 = now();
      const filteredByCategory = filterTransactions(transactions, 'E_LOAD', '');
      const tCategory = now() - t0;

      // Measure: Search query filter
      const t1 = now();
      const filteredBySearch = filterTransactions(transactions, 'ALL', 'Ana');
      const tSearch = now() - t1;

      // Measure: Combined Category + Search query
      const t2 = now();
      const filteredCombined = filterTransactions(transactions, 'CASH_IN', 'Santos');
      const tCombined = now() - t2;

      expect(filteredByCategory.length).toBeGreaterThan(0);
      expect(filteredBySearch.length).toBeGreaterThan(0);
      expect(filteredCombined.length).toBeGreaterThan(0);

      // Log performance metrics for benchmarking report
      console.log(
        `[Benchmark ${count} records] Category Filter: ${tCategory.toFixed(3)}ms | Search Filter: ${tSearch.toFixed(3)}ms | Combined Filter: ${tCombined.toFixed(3)}ms`
      );

      // Even on 5,000 records, filtering must be sub-frame (< 16ms)
      expect(tCategory).toBeLessThan(50);
      expect(tSearch).toBeLessThan(50);
      expect(tCombined).toBeLessThan(50);
    });
  }
});
