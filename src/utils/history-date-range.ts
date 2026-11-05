export type HistoryDateRange = 'ALL' | 'TODAY' | '7D' | '30D';

export function getHistoryDateBounds(
  range: HistoryDateRange,
  today = new Date(),
): { startDate?: string; endDate?: string } {
  if (range === 'ALL') return {};

  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (range === 'TODAY' ? 1 : range === '7D' ? 7 : 30));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}
