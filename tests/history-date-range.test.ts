import { getHistoryDateBounds } from '@/utils/history-date-range';

describe('transaction history date range', () => {
  it('uses local calendar-day boundaries for today', () => {
    const bounds = getHistoryDateBounds('TODAY', new Date(2026, 10, 5, 14, 30));

    expect(new Date(bounds.startDate!).getTime()).toBe(new Date(2026, 10, 5, 0).getTime());
    expect(new Date(bounds.endDate!).getTime()).toBe(new Date(2026, 10, 6, 0).getTime());
  });

  it('includes the current day and previous six days in the seven-day range', () => {
    const bounds = getHistoryDateBounds('7D', new Date(2026, 10, 5, 14, 30));

    expect(new Date(bounds.startDate!).getTime()).toBe(new Date(2026, 9, 30, 0).getTime());
    expect(new Date(bounds.endDate!).getTime()).toBe(new Date(2026, 10, 6, 0).getTime());
  });

  it('leaves bounds unset for all-time history', () => {
    expect(getHistoryDateBounds('ALL', new Date(2026, 10, 5))).toEqual({});
  });
});
