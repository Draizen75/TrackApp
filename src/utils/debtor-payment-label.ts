export function getDebtorPaymentLabel(
  paymentDate: string,
  today = new Date(),
): { label: string; isRecent: boolean } {
  const paidAt = new Date(paymentDate);
  if (Number.isNaN(paidAt.getTime())) {
    return { label: 'Payment date unavailable', isRecent: false };
  }

  const paidDay = Date.UTC(paidAt.getFullYear(), paidAt.getMonth(), paidAt.getDate());
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysSincePayment = Math.round((currentDay - paidDay) / 86_400_000);

  if (daysSincePayment === 0) return { label: 'Paid today', isRecent: true };
  if (daysSincePayment === 1) return { label: 'Paid yesterday', isRecent: true };
  if (daysSincePayment > 1) return { label: `Paid ${daysSincePayment} days ago`, isRecent: false };
  return { label: `Last payment: ${paidAt.toLocaleDateString()}`, isRecent: false };
}

export function isPaymentWithinDays(
  paymentDate: string | null | undefined,
  days: number,
  today = new Date(),
): boolean {
  if (!paymentDate || days <= 0) return false;
  const paidAt = new Date(paymentDate);
  if (Number.isNaN(paidAt.getTime())) return false;
  const paidDay = Date.UTC(paidAt.getFullYear(), paidAt.getMonth(), paidAt.getDate());
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysSincePayment = Math.floor((currentDay - paidDay) / 86_400_000);
  return daysSincePayment >= 0 && daysSincePayment < days;
}
