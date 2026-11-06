import { getEntryActionBarBottomPadding } from '@/utils/entry-layout';

describe('entry action bar layout', () => {
  it('reserves the tab bar only while the keyboard is hidden', () => {
    expect(getEntryActionBarBottomPadding(24, false)).toBe(86);
    expect(getEntryActionBarBottomPadding(24, true)).toBe(24);
  });

  it('keeps a minimum safe-area gap on devices without a bottom inset', () => {
    expect(getEntryActionBarBottomPadding(0, true)).toBe(8);
  });
});
