import {
  ledgerColors,
  ledgerElevation,
  ledgerRadius,
  ledgerSpacing,
  ledgerTypography,
} from '../src/theme/ledger';

describe('TrackApp premium design tokens', () => {
  it('keeps the dark obsidian and high-contrast gold palette available', () => {
    expect(ledgerColors.bg).toBe('#08090f');
    expect(ledgerColors.surface).toBe('#11141f');
    expect(ledgerColors.accent).toBe('#ffd166');
    expect(ledgerColors.text1).toBe('#f7f3e3');
    expect(ledgerColors.danger).toBe('#ef4444');
    expect(ledgerColors.success).toBe('#20c875');
  });

  it('provides a consistent, ascending spacing scale', () => {
    const values = Object.values(ledgerSpacing);
    expect(values.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('defines reusable radius, typography, and elevation tokens', () => {
    expect(ledgerRadius.control).toBeGreaterThan(0);
    expect(ledgerRadius.card).toBeGreaterThanOrEqual(ledgerRadius.control);
    expect(ledgerTypography.display).toBeGreaterThan(ledgerTypography.body);
    expect(ledgerElevation.accent.boxShadow).toContain('rgba(255,176,32');
  });
});
