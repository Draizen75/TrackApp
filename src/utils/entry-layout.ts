const MINIMUM_BOTTOM_INSET = 8;
const TAB_BAR_CONTENT_HEIGHT = 62;

export function getEntryActionBarBottomPadding(bottomInset: number, isKeyboardVisible: boolean) {
  const safeBottomInset = Math.max(bottomInset, MINIMUM_BOTTOM_INSET);
  return safeBottomInset + (isKeyboardVisible ? 0 : TAB_BAR_CONTENT_HEIGHT);
}
