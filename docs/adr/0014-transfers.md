# ADR-0014: P2P transfers: one attempt, one key, one approval

**Status:** Accepted · 2026-10-17 · Implements F5 (FR-TRF-01..11) · Builds on ADR-0005, ADR-0007, ADR-0012

## Context

Transfers are the first writes that move money. Everything that can go wrong with a write
can happen here: a double tap, a retry after an error, a response that never comes, an app
killed while it waits. The user must always know what happened (product §8.1), and the
server must never apply one transfer twice (FR-TRF-05). Both cores implement it, behind a
Nitro contract that should stay coarse (ADR-0002).

## Decisions

### 1. The contract: seven methods

| Method | Does | Rejects with |
|---|---|---|
| `searchContacts(query)` | FR-TRF-01: recent recipients (from the replica) and the server's directory, by name or phone; tells a typed number apart: FOUND, NOT_FOUND, SELF | network errors (the Send flow treats them as offline) |
| `startTransfer(recipientId)` | Fresh wallet from the server, recipient checked, limits for the amount step (`TransferDraft`) | NETWORK_* (FR-TRF-11: no transfer from cached data), RECIPIENT_NOT_FOUND, INVALID_ARGUMENT (self) |
| `checkTransferAmount(text)` | **Synchronous**, on every keystroke, against the current draft: parsed amount, live remaining balance, BELOW_MINIMUM / INSUFFICIENT_FUNDS / DAILY_LIMIT_EXCEEDED, and whether the keypad keeps the keystroke | NOT_FOUND (no draft) |
| `reviewTransfer(amount, note?)` | FR-TRF-03: **creates the attempt and its idempotency key**; returns what the user confirms | INVALID_ARGUMENT, the amount check's codes |
| `confirmTransfer(id, auth?)` | FR-TRF-04..09: authorizes (first call only), submits, waits up to 15 s | NOT_FOUND, INVALID_ARGUMENT |
| `getTransferStatus(id)` | FR-TRF-09: the status check for a PENDING attempt | NOT_FOUND |
| `setDailyLimit(minor)` | FR-TRF-10, developer menu: the fake server's limit (persisted; `resetData` restores 5,000.00) | INVALID_ARGUMENT |

The amount step calls `checkTransferAmount` instead of `parseMoney`, so typing costs the same
bridge crossings as before (one sync call per keystroke). The core holds the flow: one draft at
a time, and the attempts it created. Seven methods is ~250 KB of kmpCore bridge library at
ADR-0002's rate; BM-08 records the real figure.

`confirmTransfer` does both the first send and a retry: on a DRAFT attempt it needs `auth`;
on a FAILED attempt whose error is retryable it needs none and answers `auth: NOT_REQUIRED`.
That keeps one method for "send this attempt" and matches requirements §3.2, where
FAILED → RETRY → SUBMITTING skips authorization.

### 2. Idempotency (FR-TRF-05, FR-FAKE-02/03)

- **The key is created at review**, a random UUID v4 from the platform's secure random. Going
  back to edit the amount and reviewing again is a new attempt with a new key; nothing was
  sent under the old one.
- **The same attempt always sends the same key**: a double tap (the second `confirmTransfer`
  joins the one in flight and gets the same result), Retry after SERVER_ERROR or
  NETWORK_UNAVAILABLE, and the status check.
- **The server records each key** with its request (recipient, amount, note) and the
  transaction it produced. The same key with the same request returns that transaction again,
  in whatever state it is now; with a different request it's IDEMPOTENCY_CONFLICT.
- **What the server records.** Business refusals (INSUFFICIENT_FUNDS, DAILY_LIMIT_EXCEEDED) are
  FAILED transactions, visible in History like the seeded ones, and replaying their key returns
  them: they aren't retryable, so the user changes the amount and gets a new key. Errors where
  the request never got applied (SERVER_ERROR, NETWORK_UNAVAILABLE: the fake fails *before*
  doing anything) record nothing, so a retry with the same key is applied once.
  RECIPIENT_NOT_FOUND and INVALID_ARGUMENT are refusals of the request itself: nothing recorded.
- Server transaction ids are `trf-<n>` in order, so both cores produce the same ids
  (BM-PAR-04). `fixtures/transfer.json` → `server` walks the cases.

### 3. Confirmation (FR-TRF-04, ADR-0012)

- **Biometrics sign the transfer**, not a challenge: `pocketly:transfer:v1`, amount, recipient
  and idempotency key (ADR-0012 §1). The signature covers this attempt only; an unlock
  signature or one for another key fails verification. The core verifies it against the
  public key it stored; the server will verify it once a real backend exists (ADR-0012, Limits).
- **The PIN** is checked like `verifyPin`: counted first, five wrong ones start the lockout
  (FR-LOCK-04).
- **Anything short of OK leaves the attempt in DRAFT** with nothing sent: cancel, a wrong PIN,
  a biometric lockout. Biometric failures follow ADR-0012 §3 (KEY_INVALIDATED and FAILED turn
  biometric unlock off; then the PIN).
- The note isn't signed: it doesn't move money. It is part of the request the key protects.

### 4. Timeouts and late answers (FR-TRF-09, ADR-0007)

- A submission gives up after `writeTimeoutMs` (default `TRANSFER_TIMEOUT_MS`, 15 s; reads
  keep their 10 s). The attempt becomes **PENDING**: the core writes a pending row into the
  replica, with the attempt's key, so History and Home show it (FR-HIST, FR-HOME-04) and the
  balance counts it, as the server's does.
- A late response is discarded (ADR-0007 §1). The server finishes its work in its own scope
  (§2): a Kotlin coroutine in the backend's scope, a promise nobody awaits in JS.
- `getTransferStatus` asks the server by key. A transaction there settles the attempt
  (SUCCESS or FAILED); none means the request never arrived, which is FAILED with
  NETWORK_TIMEOUT, retryable with the same key. The next ledger sync replaces the pending row
  with the server's transaction (matched by idempotency key).
- **The fake's TIMEOUT mode** (FR-FAKE-05): the server applies the transfer as PENDING and never
  answers; it settles 5–20 s after it arrived, to SUCCESS, or FAILED with SERVER_ERROR at the
  simulation's failure rate. Two seeded draws (delay, then outcome), the same in both cores.
  Settling is lazy: the server settles what's due at the start of each call, so the status
  check and the next sync see it. (FR-FAKE-05's `WalletEvent` arrives with notifications, F9.)
- **Process death** (NFR-REL-03): attempts that reached the server are in the replica as rows
  with their key, so a relaunch shows them; the status check works from the row's key.

### 5. Money and limits

- Minimum 1.00, maximum min(balance, today's remaining limit), fee 0. Both the amount step
  and the server check the balance first (INSUFFICIENT_FUNDS), then the limit
  (DAILY_LIMIT_EXCEEDED); the screen offers "Send <max> instead". The server checks again; a
  balance that moved meanwhile ends in a FAILED result, never a negative balance.
- **Optimistic update, then the truth** (product §6.1 step 8): SUCCESS and PENDING update the
  replica's wallet and history at once; FAILED leaves both as they were (nothing was applied).
  The next refresh brings the server's numbers (NFR-MONEY-03).
- The daily limit is the server's (FR-TRF-10): `Wallet.dailyLimit` / `usedToday`, counted in
  the user's time zone (ADR-0006). `setDailyLimit` changes it for demos.

### 6. Contacts

The fake server has a directory of 10 users (FR-FAKE-01), the seed's contacts, now with
Indonesian numbers so phone search uses the same rules as onboarding (ADR-0013). Recent
recipients come from the replica, so they show without a server call. The user's own verified
phone is never a recipient (FR-TRF-01): SELF.

### 7. The Send flow in the app

Screens follow the "Pocketly Send Flow" design: recipient → amount → review → (system
biometric prompt, or PIN) → result, as root-stack screens above the tabs (product §7.3 rule 2).
The amount keypad sends every keystroke to `checkTransferAmount` and keeps only what the core
accepts. Review's "Confirm and send" opens the biometric prompt when biometrics are on; its
"Use PIN" button, or any biometric failure, leads to the PIN screen, whose Cancel returns to
review. While `confirmTransfer` runs, a processing screen covers the one that started it
(FR-TRF-06). The result replaces the flow in the back stack, so Back and Done go to Home
(rule 3). A pending result asks `getTransferStatus` every 5 s while it's open.

## Consequences

- Seed contacts' phones changed (`+1555…` → `+62 8…`): `golden.json` is regenerated, in both
  cores.
- `fixtures/transfer.json` is the parity fixture for search, amount checks, notes, retryable
  codes and the server's idempotency.
- The server schema gains a table of idempotency keys; installs migrate.

## Limits

- The fake server is in-process: "the server keeps working" is simulated, and so is the
  network. A crash of the app is also a crash of the fake server; pending transfers settle on
  its next start.
- No signature check on the server yet (ADR-0012).
- Offline transfers are blocked, not queued (FR-SYNC-01 is P2).
