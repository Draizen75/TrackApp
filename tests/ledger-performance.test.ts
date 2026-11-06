import { analyzeDebtLedger, type Transaction } from '@/hooks/useDbQueries';

describe('ledger scalability', () => {
  it('measures debt analysis on a large chronological ledger and preserves results for unordered input', () => {
    const customerCount = 6000;
    const start = Date.parse('2020-01-01T00:00:00.000Z');
    const transactions: Transaction[] = [];

    for (let index = 0; index < customerCount; index += 1) {
      const customerId = index + 1;
      const debtId = index * 2 + 1;
      const debtTime = new Date(start + index * 2).toISOString();
      const paymentTime = new Date(start + index * 2 + 1).toISOString();

      transactions.push({
        id: debtId,
        type: 'E_LOAD',
        amount: 100,
        fee: 10,
        channel: 'GCASH',
        customer_id: customerId,
        is_debt: 1,
        deduct_fee: 0,
        created_at: debtTime,
      });
      transactions.push({
        id: debtId + 1,
        type: 'DEBT_PAYMENT',
        amount: 110,
        fee: 0,
        channel: 'GCASH',
        customer_id: customerId,
        is_debt: 0,
        deduct_fee: 0,
        target_debt_id: debtId,
        created_at: paymentTime,
      });
    }

    const startedAt = performance.now();
    const chronological = analyzeDebtLedger(transactions);
    const chronologicalMs = performance.now() - startedAt;

    expect(chronological.customers.size).toBe(customerCount);
    expect(chronological.allocation).toMatchObject({
      principalPaid: customerCount * 100,
      contractualEarningsPaid: customerCount * 10,
      pendingPrincipal: 0,
      pendingEarnings: 0,
    });

    const unorderedStartedAt = performance.now();
    const unordered = analyzeDebtLedger([...transactions].reverse());
    const unorderedMs = performance.now() - unorderedStartedAt;

    expect(unordered.allocation).toEqual(chronological.allocation);
    expect(Array.from(unordered.customers.entries())).toEqual(Array.from(chronological.customers.entries()));

    // Keep timings visible in CI as a baseline; avoid a brittle machine-specific threshold.
    console.info(
      `[ledger-performance] ${transactions.length.toLocaleString()} records: chronological=${chronologicalMs.toFixed(1)}ms, unordered=${unorderedMs.toFixed(1)}ms`
    );
  });
});
