# ADR-0007: Timeouts abandon a request; late responses have no effect

**Status:** Accepted · 2026-10-04

## Context

NFR-REL-01 gives every backend call a timeout. The two cores build it differently:
`Promise.race` in JS doesn't stop the request (it keeps running and settles later), while
Kotlin's `withTimeout` cancels the coroutine. Without a stated rule, the builds would behave
differently in exactly the case that looks fine: a response arriving *after* the timeout.

## Decision

1. **The client abandons, it doesn't undo.** After `readTimeoutMs` the caller gets
   `NETWORK_TIMEOUT`. A response (or failure) that arrives later is **discarded**: it settles
   nothing, updates nothing, and is never an unhandled rejection. JS implements this
   explicitly (`TimeoutWalletApi` ignores settlements after the timeout); Kotlin gets it from
   cancellation.
2. **Server-side work is not the client's to cancel.** A real server keeps going after the
   client gives up. For reads that's invisible. For M3 writes (transfers), the fake backend
   must run its server-side work in **its own scope** (Kotlin) so a client timeout doesn't
   abort it; the transfer then resolves later (FR-TRF-09 pending → status check).
3. **The UI applies only the newest load.** `useHomeData` tags each load; an older one
   finishing late (slow, failed or timed out) can't overwrite newer data or raise a stale error.
4. **Tested where it's observable.** Contract test "a late response/failure after the timeout
   has no effect" (`network.json` → `lateResponse`) runs in Jest and JUnit, with a configurable
   `readTimeoutMs` so it takes < 1 s. Jest fails any test that leaves an unhandled rejection.
   An app test proves the newest-load rule (it fails with the guard removed).

## Consequences

- `NetworkSimulation.readTimeoutMs` (default 10 s) exists for tests and the developer menu.
- When writes land in M3, add a contract test: a transfer that times out on the client still
  completes on the server and is visible on the next status check, in both cores.

## Verified on device (2026-10-05, slice 4)

`apps/mobile/scripts/late-response-check.sh` on the vivo V2538, both builds (perf): with 6 s
latency and a 2 s timeout, a server-side incoming transfer made during the slow period stayed
invisible after its late response arrived. Home kept the replica's balance and the "taking
longer than usual" banner, the transfer row didn't appear, and an OFFLINE read showed the
replica unchanged. Back on NORMAL the transfer appeared. This covers the wallet fetch and the
first-page ledger sync, which the contract test's unchanged-data check can't distinguish.
