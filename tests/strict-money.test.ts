import { isValidMoneyInput } from '../src/utils/strict-money';

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
