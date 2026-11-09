const MINIMUM_BOTTOM_INSET = 8;

export function getEntryActionBarBottomPadding(bottomInset: number, isKeyboardVisible: boolean) {
  // The tab bar is rendered by the navigator and already occupies its own
  // screen edge. Do not reserve its height a second time inside this action bar.
  // Keep only the device safe-area inset when the keyboard is closed.
  return isKeyboardVisible ? 8 : Math.max(bottomInset, MINIMUM_BOTTOM_INSET);
}
