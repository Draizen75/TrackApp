import { getEntryActionBarBottomOffset } from '@/utils/entry-layout';

describe('entry action bar positioning', () => {
  it('positions the action bar directly above the tab bar when the keyboard is hidden', () => {
    expect(getEntryActionBarBottomOffset(24, false)).toBe(86);
    expect(getEntryActionBarBottomOffset(0, false)).toBe(70);
  });

  it('anchors the action bar to the keyboard-resized screen when the keyboard is visible', () => {
    expect(getEntryActionBarBottomOffset(24, true)).toBe(0);
    expect(getEntryActionBarBottomOffset(0, true)).toBe(0);
  });
});
