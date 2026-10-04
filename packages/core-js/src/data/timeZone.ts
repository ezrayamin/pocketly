import { CoreError } from '@pocketly/core-contract';
import { UTC_OFFSET, zonedMonth, type OffsetAt, type ZonedMonth } from '../domain/zonedCalendar';

/**
 * The platform's time-zone data, behind the pure OffsetAt function the domain uses.
 * JS: Intl (ICU tz data). Kotlin: java.util.TimeZone / NSTimeZone (TimeZoneSupport.kt).
 * Mirrors shared/.../data/UserTimeZone.kt.
 */
function intlOffsetAt(zoneId: string): OffsetAt {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zoneId,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    throw new CoreError('INVALID_ARGUMENT', `Unknown time zone "${zoneId}"`);
  }
  return (epochMillis) => {
    const parts: Record<string, number> = {};
    for (const p of format.formatToParts(new Date(epochMillis))) {
      if (p.type !== 'literal') parts[p.type] = Number(p.value);
    }
    const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
    return local - Math.floor(epochMillis / 1000) * 1000;
  };
}

const MONTH_CACHE_SIZE = 24;

export class UserTimeZone {
  readonly offsetAt: OffsetAt;
  private readonly months = new Map<string, ZonedMonth | undefined>();

  constructor(readonly zoneId: string) {
    this.offsetAt = zoneId === 'UTC' ? UTC_OFFSET : intlOffsetAt(zoneId);
  }

  /** Cached per month: repeated summaries (BM-03) don't redo the offset lookups. */
  month(month: string): ZonedMonth | undefined {
    if (!this.months.has(month)) {
      if (this.months.size >= MONTH_CACHE_SIZE) {
        this.months.delete(this.months.keys().next().value as string);
      }
      this.months.set(month, zonedMonth(month, this.offsetAt));
    }
    return this.months.get(month);
  }
}
