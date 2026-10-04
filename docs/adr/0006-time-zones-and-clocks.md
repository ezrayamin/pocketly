# ADR-0006: Time zones and clocks live in the core

**Status:** Accepted · 2026-10-04

## Context

Both cores computed "today" (the daily-limit window, FR-TRF-10) and month boundaries
(computeSpendingSummary) in **UTC**. For a user in Jakarta (UTC+7) the daily limit reset at
07:00, and "this month" started at 07:00 on the 1st. The fake backend's clock was also frozen
at 2026-10-01 in the app, so "Today" labels disagreed with the phone's date.

## Decision

1. **Zone.** `Core.setTimeZone(ianaId)` (default `"UTC"`). The app passes the device zone
   (`Intl…resolvedOptions().timeZone`) to whichever core it bundles, so both builds use the
   same zone. The daily-limit day, month ranges and `byDay` dates are all local.
2. **Tz data stays at the edge.** `domain/` gets an `OffsetAt(epochMillis) → offset` function;
   the data layer supplies it from the platform (JS: `Intl.DateTimeFormat`; Kotlin:
   `java.util.TimeZone` on JVM/Android, `NSTimeZone` on iOS). No kotlinx-datetime dependency.
3. **Same algorithm, bounded lookups.** Local midnight = `local − offset(local − offset(local))`.
   A month's offsets are found by probing once per day and bisecting to the minute at DST
   changes (~31–45 lookups per month), cached per zone and month. Per-transaction work in the
   BM-03 loop is a segment lookup, so the benchmark still compares the loop, not the
   platforms' tz libraries.
4. **Clock.** `DatasetConfig.nowMillis` is optional: set = frozen clock (tests, golden data,
   benchmarks, BM-PAR-04); absent = device clock (the app, `LIVE_DATASET`).
5. **Parity is tested at the edges.** `fixtures/time-zones.json` (hand-written) covers 23:59 /
   00:01 local, month end, a negative-offset zone and the New York DST change (a 25-hour day).
   Jest runs it against core-js and JUnit against the KMP core.

## Consequences

- `golden.json` is unchanged: with the default `"UTC"` zone the old results are reproduced exactly.
- `Wallet.usedToday` is computed on read (newest-first scan up to local midnight) rather
  than as a running total, because "today" now moves with the live clock.
- Display formatting ("Today, 09:40 AM", "Yesterday") stays in the UI, in the same device zone.
