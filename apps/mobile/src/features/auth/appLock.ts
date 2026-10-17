/**
 * FR-LOCK-02 timing. Time away is measured on two clocks and the larger wins: the wall clock
 * keeps counting while the phone sleeps but can be moved back by hand; the monotonic clock can't
 * be moved but (on Android) stops while the phone sleeps. Moving the clock back alone therefore
 * can't skip a re-lock. If the process dies in the background, the next start is a cold start,
 * which always locks (FR-LOCK-01).
 */

// Hermes provides the High Resolution Time API; the app's TS lib config doesn't declare it.
declare const performance: { now(): number };

export interface LeftAt {
  wallMs: number;
  monoMs: number;
}

export function leftNow(): LeftAt {
  return { wallMs: Date.now(), monoMs: performance.now() };
}

export function awayMs(since: LeftAt, now: LeftAt = leftNow()): number {
  return Math.max(now.wallMs - since.wallMs, now.monoMs - since.monoMs);
}

/** 0 means "lock every time the app goes to the background". */
export function shouldRelock(away: number, timeoutMs: number): boolean {
  return away >= timeoutMs;
}
