const MINIMUM_BOTTOM_INSET = 8;
const TAB_BAR_CONTENT_HEIGHT = 62;

/**
 * Positions the entry action bar directly above the overlaid tab bar.
 * While the keyboard is open, the tab bar is hidden and the action bar
 * sits at the bottom edge of the keyboard-resized screen.
 */
export function getEntryActionBarBottomOffset(bottomInset: number, isKeyboardVisible: boolean) {
  if (isKeyboardVisible) return 0;
  return TAB_BAR_CONTENT_HEIGHT + Math.max(bottomInset, MINIMUM_BOTTOM_INSET);
}
