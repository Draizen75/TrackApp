import { getSettlementPrincipalBreakdown, isValidMoneyInput } from '../src/utils/strict-money';

describe('isValidMoneyInput', () => {
  it.each(['150', '150.5', '150.50', '0.01', ' 25.00 '])('accepts valid monetary input %s', (value) => {
    expect(isValidMoneyInput(value, false)).toBe(true);
  });

  it.each(['150abc', '12.50xyz', '1,500', '', ' ', '-1', '+1', '1.234', 'Infinity', 'NaN'])('rejects malformed or unsupported input %s', (value) => {
    expect(isValidMoneyInput(value, true)).toBe(false);
  });

  it('allows zero only when configured', () => {
    expect(isValidMoneyInput('0', true)).toBe(true);
    expect(isValidMoneyInput('0', false)).toBe(false);
  });
});


describe('getSettlementPrincipalBreakdown', () => {
  it('treats an empty principal field as zero for profit-only settlements', () => {
    expect(getSettlementPrincipalBreakdown('', 500)).toEqual({ principal: 0, excess: 0 });
    expect(getSettlementPrincipalBreakdown('   ', 500)).toEqual({ principal: 0, excess: 0 });
  });

  it('keeps an explicit zero principal at zero', () => {
    expect(getSettlementPrincipalBreakdown('0', 500)).toEqual({ principal: 0, excess: 0 });
  });

  it('caps principal at the outstanding debt and preserves excess as profit', () => {
    expect(getSettlementPrincipalBreakdown('650.00', 500)).toEqual({ principal: 500, excess: 150 });
  });

  it('does not update the principal split for malformed input', () => {
    expect(getSettlementPrincipalBreakdown('10abc', 500)).toBeNull();
  });
});
