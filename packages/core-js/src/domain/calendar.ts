/**
 * UTC calendar math without `Date`, so both cores run the same algorithm
 * (Howard Hinnant's days_from_civil / civil_from_days).
 * Mirrors shared/.../domain/UtcCalendar.kt.
 */

export const MILLIS_PER_DAY = 86_400_000;

export function epochDay(millis: number): number {
  return Math.floor(millis / MILLIS_PER_DAY);
}

export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** `YYYY-MM-DD` for an epoch day. */
export function isoDate(epochDayValue: number): string {
  const z = epochDayValue + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${year}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Parses `YYYY-MM` into a half-open [start, end) millis range, or `undefined`. */
export function monthRange(month: string): { start: number; end: number } | undefined {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const m = Number(match[2]);
  const start = daysFromCivil(year, m, 1) * MILLIS_PER_DAY;
  const end = (m === 12 ? daysFromCivil(year + 1, 1, 1) : daysFromCivil(year, m + 1, 1)) * MILLIS_PER_DAY;
  return { start, end };
}
