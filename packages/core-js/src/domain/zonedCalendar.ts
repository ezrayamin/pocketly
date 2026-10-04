import { MILLIS_PER_DAY, daysFromCivil } from './calendar';

/**
 * Calendar math in the user's time zone (ADR-0006). Pure: the zone's UTC offset comes in
 * as a function, so this file has no platform dependency. Mirrors
 * shared/.../domain/ZonedCalendar.kt — same steps, same number of offset lookups.
 */

/** Offset (local − UTC) in ms at a UTC instant. */
export type OffsetAt = (epochMillis: number) => number;

export const UTC_OFFSET: OffsetAt = () => 0;

const MINUTE = 60_000;

/** Local calendar day (days since 1970-01-01, local) containing `epochMillis`. */
export function localEpochDay(epochMillis: number, offsetAt: OffsetAt): number {
  return Math.floor((epochMillis + offsetAt(epochMillis)) / MILLIS_PER_DAY);
}

/** UTC instant of local midnight at the start of local day `epochDay`. */
export function localMidnight(epochDay: number, offsetAt: OffsetAt): number {
  const local = epochDay * MILLIS_PER_DAY;
  const guess = local - offsetAt(local);
  return local - offsetAt(guess);
}

/** A run of time with one UTC offset, valid from `from` until the next segment. */
export interface OffsetSegment {
  from: number;
  offset: number;
}

/**
 * Offset segments covering [start, end). Probes once per day and bisects to the minute
 * where the offset changes (DST), so a month costs ~31–45 lookups, not one per transaction.
 */
export function offsetSegments(start: number, end: number, offsetAt: OffsetAt): OffsetSegment[] {
  const segments: OffsetSegment[] = [{ from: start, offset: offsetAt(start) }];
  let prevT = start;
  let prevOffset = segments[0].offset;
  while (prevT < end) {
    const t = Math.min(prevT + MILLIS_PER_DAY, end);
    const offset = offsetAt(t);
    if (offset !== prevOffset) {
      let lo = prevT;
      let hi = t;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / (2 * MINUTE)) * MINUTE;
        if (offsetAt(mid) === prevOffset) lo = mid;
        else hi = mid;
      }
      segments.push({ from: hi, offset });
      prevOffset = offset;
    }
    prevT = t;
  }
  return segments;
}

/** Offset at `epochMillis` from precomputed segments (≤ 3 per month in practice). */
export function segmentOffset(segments: readonly OffsetSegment[], epochMillis: number): number {
  for (let i = segments.length - 1; i > 0; i--) {
    if (epochMillis >= segments[i].from) return segments[i].offset;
  }
  return segments[0].offset;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface ZonedMonth {
  start: number;
  end: number;
  segments: OffsetSegment[];
}

/** Local month `YYYY-MM` as a half-open UTC range plus its offset segments, or undefined. */
export function zonedMonth(month: string, offsetAt: OffsetAt): ZonedMonth | undefined {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const m = Number(match[2]);
  const start = localMidnight(daysFromCivil(year, m, 1), offsetAt);
  const end = localMidnight(m === 12 ? daysFromCivil(year + 1, 1, 1) : daysFromCivil(year, m + 1, 1), offsetAt);
  return { start, end, segments: offsetSegments(start, end, offsetAt) };
}
