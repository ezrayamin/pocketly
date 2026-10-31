# ADR-0015: Top-up rides the transfer pipeline

**Status:** Accepted · 2026-10-30 · Implements F6 (FR-TOP-01..03) · Builds on ADR-0007, ADR-0014

## Context

A top-up adds money to the wallet from a mocked payment method (FR-TOP-02: "Bank transfer" or
"Card", 2–5 s of simulated processing). FR-TOP-03 asks for the same outcome states as a
transfer: success, failure with retry, and pending after a timeout. Everything ADR-0014 built for
that (an attempt with one idempotency key, the 15 s write timeout, the pending row and the status
check, the server that never applies a key twice) applies unchanged. What differs is the
direction of the money, who the counterparty is, and what has to be approved.

Each bridged method and type costs kmpCore ~18 KB of bridge library (BM-08, `2026-10-17_mid-06`),
and ADR-0002 asks for a coarse contract.

## Decisions

### 1. Two new methods; confirming, retrying and checking reuse the transfer ones

| Method | Does | Rejects with |
|---|---|---|
| `checkTopUpAmount(text)` | **Synchronous**, on every keystroke: parsed amount, BELOW_MINIMUM / ABOVE_MAXIMUM, and whether the keypad keeps the keystroke (`AmountCheck`, as `checkTransferAmount`) | nothing |
| `reviewTopUp(amount, method)` | FR-TOP-01/02: fresh wallet from the server, amount and method checked, **creates the attempt and its idempotency key**; returns what the user confirms (`TopUpReview`) | NETWORK_* (no top-up from cached data, as FR-TRF-11), INVALID_ARGUMENT, the amount check's codes |

`confirmTransfer(id)` sends a reviewed top-up and retries a failed one; `getTransferStatus(id)`
resolves a pending one. Both already work on "an attempt with a key", and the core's attempts now
carry their kind. Naming them "transfer" is the price of not adding two more methods; the
contract's documentation says they take either kind.

New contract types: `TopUpMethod` (`BANK_TRANSFER`, `CARD`) and `TopUpReview`. New values:
`ABOVE_MAXIMUM` in `AmountRejectReason`, `PAYMENT_DECLINED` in `ErrorCode`. Results are
`TransferResult`s whose transaction is a `TOP_UP`.

`checkTopUpAmount` needs no draft: a top-up's limits don't depend on the wallet (§3), so the
amount step makes no server call and works offline; `reviewTopUp` is where an offline top-up
stops.

### 2. No PIN or biometrics

A top-up moves money *into* the wallet, from a payment method that authorizes the charge itself
(the card's 3-D Secure, the bank's own app); approving it again in Pocketly protects nothing the
payment method doesn't. So the first `confirmTransfer` of a top-up takes no `auth` (passing one
is INVALID_ARGUMENT) and answers `auth: NOT_REQUIRED`, as a retry does. Requirements §3.2's
DRAFT → AUTHORIZING → SUBMITTING passes AUTHORIZING immediately.

### 3. Money and limits

- Minimum `TOP_UP_MIN_MINOR` (5.00), maximum `TOP_UP_MAX_MINOR` (1,000.00) per top-up, fee 0.
  Presets 10, 25, 50, 100 (`TOP_UP_PRESETS_MINOR`, FR-TOP-01). Amounts above the maximum keep
  the typed text and show a message, as an amount above the balance does in Send.
- No balance cap and no daily limit: the daily limit (FR-TRF-10) counts money *leaving* the
  wallet, and the server's `usedSince` already counts only TRANSFER_OUT and QR_PAYMENT.
- **Optimistic update, then the truth** (ADR-0014 §5), with the sign reversed: SUCCESS adds the
  amount to the replica's balance at once. PENDING doesn't: the server counts incoming money
  only once it's SUCCESS, so a pending top-up shows in History but not in the balance. FAILED
  changes nothing.

### 4. The server

- **One key table for both kinds.** The server records a top-up's key in the same table as a
  transfer's, with the payment method's id (`pm-bank`, `pm-card`: the seed's top-up
  counterparties) where a transfer has the recipient's. Same key, same request returns the
  original; a different request (another amount or method, or a transfer) is
  IDEMPOTENCY_CONFLICT. Transaction ids are `tup-<n>`, counted separately from `trf-<n>`.
- **Recorded on arrival, settled after processing.** The server records the top-up as PENDING
  the moment it has the request, then processes it (2–5 s, `TOP_UP_PROCESSING_MIN_MS`..`MAX_MS`,
  a seeded draw) and settles it to SUCCESS, or FAILED with PAYMENT_DECLINED. A retry or status
  check that arrives during processing finds the PENDING transaction instead of starting a second
  charge; the client's 15 s timeout ends as PENDING if processing and latency outlast it, and the
  server finishes anyway (ADR-0007 §2).
- **Held settlements carry their failure reason** (server schema version 3, `2.sqm`): a top-up
  that is still processing when the app dies settles on the next start, with PAYMENT_DECLINED if
  it was going to be declined. Rows from version 2 have none and settle as before (SERVER_ERROR).
- **The fake's switches** live in `NetworkSimulation`, which the developer menu already sets,
  so no new method: `declineTopUps` (FR-DEV: show the failure state on demand) and
  `topUpProcessingMs` (a fixed processing time instead of the draw: tests use 0). TIMEOUT mode
  holds a top-up as PENDING and settles it 5–20 s later, as transfers (ADR-0014 §4).
- **What's retryable:** SERVER_ERROR, NETWORK_UNAVAILABLE and NETWORK_TIMEOUT, as for
  transfers. PAYMENT_DECLINED is a recorded FAILED transaction and isn't: the user picks another
  method or amount and gets a new key.

### 5. The Top-Up flow in the app

Home's Top-Up quick action opens the flow: amount (preset chips and the keypad, every keystroke
through `checkTopUpAmount`) → method (Bank transfer, Card) → review → processing → result, as
root-stack screens above the tabs (product §7.3 rule 2). The screens reuse the Send flow's
components and look; the design canvas has no Top-Up artboards. Review's button confirms
directly (no prompt). The result replaces the flow in the back stack; a pending result asks
`getTransferStatus` every 5 s while it's open, as in Send.

## Consequences

- `fixtures/topup.json` is the parity fixture for the amount check and the server's cases.
- The server schema gains a column; installs migrate (`2.sqm`).
- `confirmTransfer` / `getTransferStatus` take either kind of attempt; their documentation and
  ADR-0014 §1 say so.

## Limits

- The payment methods are names, not instruments: no card number, no bank account, no 3-D
  Secure step. A real backend would add the provider's own authorization flow.
- Same as ADR-0014: in-process fake server and network.
