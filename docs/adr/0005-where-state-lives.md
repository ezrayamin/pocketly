# ADR-0005: What goes through the core contract (and what doesn't)

**Status:** Accepted · 2026-10-04 · Supersedes the first Home slice, which put hide/show behind the contract

## Context

The benchmark compares *where business logic runs*. Every method on the `Core` contract is
implemented twice (TS and Kotlin) and bridged once (Nitro). Putting UI preferences there
doubles the work for state that has nothing to do with the comparison.

## Decision

| Kind of state | Lives in | Examples |
|---|---|---|
| Business logic, money, transactions, backend access | **Core contract** (both cores) | balance, transfers, limits, summaries, time-zone rules (ADR-0006) |
| Security settings | **Core contract** (both cores) | PIN hash, biometrics on/off, auto-lock timeout (M3, NFR-SEC-01) |
| UI preferences | **`@pocketly/native-preferences`** (one TS package, same in both builds) | hide/show balance, dismissed banners, last-seen tab |

`@pocketly/native-preferences` is backed by SharedPreferences `pocketly.preferences` (Android)
and NSUserDefaults (iOS) through a tiny native module that both builds link identically.

**Test for new state:** if getting it wrong could misstate money, move money, or weaken
security, it goes in the core. If it only changes how the screen looks, it's a UI preference.

## Consequences

- `getPreferences` / `setBalanceHidden` were removed from the contract, the Nitro spec and both cores.
- UI preferences are not part of BM-PAR parity; they're identical code in both builds.
