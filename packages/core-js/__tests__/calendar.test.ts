import { daysFromCivil, epochDay, isoDate, monthRange } from '../src/domain/calendar';

describe('UTC calendar', () => {
  it('round-trips against Date for 1970..2100', () => {
    for (let day = 0; day < 47_500; day += 13) {
      expect(isoDate(day)).toBe(new Date(day * 86_400_000).toISOString().slice(0, 10));
    }
  });

  it('handles leap years', () => {
    expect(isoDate(daysFromCivil(2024, 2, 29))).toBe('2024-02-29');
    expect(isoDate(daysFromCivil(2100, 3, 1) - 1)).toBe('2100-02-28');
  });

  it('builds half-open month ranges', () => {
    expect(monthRange('2026-12')).toEqual({ start: Date.UTC(2026, 11, 1), end: Date.UTC(2027, 0, 1) });
    expect(epochDay(Date.UTC(2026, 8, 30, 23, 59))).toBe(daysFromCivil(2026, 9, 30));
    expect(monthRange('2026-00')).toBeUndefined();
  });
});
