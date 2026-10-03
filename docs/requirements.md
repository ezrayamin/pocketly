# Pocketly — Requirements

**Status:** Draft v0.1 · **Related:** `product.md` · **Last updated:** 2026-10-03

Requirement IDs are stable so they can be referenced in issues, commits and tests (for example `FR-TRF-04`).
Priority follows `product.md`: **P0** MVP · **P1** should · **P2** stretch.

---

## 1. Functional Requirements

### 1.1 Onboarding & Auth (F1) — P0

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-AUTH-01 | User registers with a phone number | Rejects invalid formats; shows inline error; continue button disabled until valid |
| FR-AUTH-02 | User verifies the number with a 6-digit OTP (mocked) | Fixed OTP `123456` accepted; wrong OTP shows an error; 3 wrong attempts → 30 s cooldown; "Resend" enabled after 30 s |
| FR-AUTH-03 | User creates a 6-digit PIN | Must be entered twice and match; rejects trivial PINs (`000000`, `123456`, all repeating digits) |
| FR-AUTH-04 | User can enable biometric unlock | Offered only if the device supports it; can be turned off in Settings |
| FR-AUTH-05 | PIN is never stored in plain text | Stored as a salted hash via secure storage (Keychain/Keystore); never logged |

### 1.2 App Lock (F2) — P0

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-LOCK-01 | App requires unlock on cold start | Lock screen shown before any financial data |
| FR-LOCK-02 | App re-locks after a period in the background | Re-locks after 60 s in background (configurable in dev menu) |
| FR-LOCK-03 | App-switcher snapshot hides content | A blur or privacy overlay is applied when the app moves to the background |
| FR-LOCK-04 | Too many wrong PINs | 5 wrong attempts → 5 min lockout with a countdown |

### 1.3 Home & Balance (F3) — P0

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-HOME-01 | Show the current balance | Formatted with the currency symbol and thousands separators; skeleton shown while loading |
| FR-HOME-02 | Hide/show balance toggle | Masks as `••••••`; preference persists across sessions |
| FR-HOME-03 | Quick actions: Send, Top-Up, Pay (QR), Receive | Each opens its flow in one tap |
| FR-HOME-04 | Recent transactions (last 5) | Pending items visibly marked; tapping opens detail |
| FR-HOME-05 | Pull to refresh | Refreshes balance and recent transactions; shows "Last updated hh:mm" |

### 1.4 Transaction History (F4) — P0

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-HIST-01 | Paginated list, newest first | Loads 20 per page; infinite scroll; no duplicates across pages |
| FR-HIST-02 | Grouped by date | Section headers: "Today", "Yesterday", then dates |
| FR-HIST-03 | Filter by type and status | Type: transfer in/out, top-up, payment; status: success, pending, failed |
| FR-HIST-04 | Offline cache | Last fetched history readable offline, with an offline banner |
| FR-HIST-05 | Transaction detail screen | Shows ID, type, counterparty, amount, status, timestamps, note; copy ID; share receipt |

### 1.5 P2P Transfer (F5) — P0

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-TRF-01 | Choose a recipient | From recent contacts or search by phone; cannot select self |
| FR-TRF-02 | Enter an amount | Min 1.00, max = min(balance, daily limit); invalid input blocked as typed; shows remaining balance live |
| FR-TRF-03 | Review screen before confirming | Shows recipient, amount, fee, note, resulting balance |
| FR-TRF-04 | Confirm with biometrics or PIN | Biometric prompt first; PIN fallback; cancel returns to review without side effects |
| FR-TRF-05 | Idempotent submission | One idempotency key per transfer attempt (created at review); double-tap and retry reuse it; server never applies it twice |
| FR-TRF-06 | Pending state | Confirm button disabled while submitting; processing screen shown |
| FR-TRF-07 | Success state | Animated success, transaction ID, share receipt; balance and history updated |
| FR-TRF-08 | Failure state | Human-readable reason per error code (see §4.3); Retry reuses the same key; balance rolled back |
| FR-TRF-09 | Timeout state | After 15 s with no response, show "Still processing" and mark the transaction as pending; it resolves later via a status check |
| FR-TRF-10 | Daily transfer limit | Default limit is configurable; exceeding it blocks the transfer at the amount step with a clear message |
| FR-TRF-11 | Offline behavior (MVP) | Transfer entry blocked when offline, with a clear message (queueing is P2: FR-SYNC-01) |

### 1.6 Top-Up (F6) — P1

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-TOP-01 | Choose amount (presets + custom) | Presets shown as chips; custom amount validated |
| FR-TOP-02 | Choose a mocked payment method | "Bank transfer" and "Card" (mocked); simulated 2–5 s processing |
| FR-TOP-03 | Same outcome states as transfer | Success / failed / pending handled like FR-TRF-06 to FR-TRF-09 |

### 1.7 QR Pay (F7) & Receive (F8) — P1

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-QR-01 | Scan a QR with the camera | Camera permission requested in context; denial shows a path to Settings |
| FR-QR-02 | Parse and validate the QR payload in KMP | Invalid or unknown payload → "Not a valid payment code"; never crashes |
| FR-QR-03 | Static vs dynamic QR | Dynamic QR: amount locked; static QR: user enters the amount |
| FR-QR-04 | Payment reuses the transfer confirmation pipeline | Same idempotency, states and error handling as §1.5 |
| FR-QR-05 | My QR screen | Shows the user's own QR code (encodes a user ID); screen brightness raised while shown |

> The QR payload format is a simple app-defined JSON/URI scheme for this project. It is not a real national QR standard.

### 1.8 Notifications (F9) — P1

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-NOTIF-01 | In-app banner when money arrives | The fake backend can emit simulated incoming transfers; a banner appears and the balance updates |
| FR-NOTIF-02 | Pending transaction resolution | When a pending transaction resolves, notify the user and update history |
| FR-NOTIF-03 | Notification list | List of the last 50 notifications; unread badge on Home |

### 1.9 Invest / Live Prices (F10) — P2

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-INV-01 | Watchlist of 5–10 assets with live prices | Prices stream via WebSocket; price changes flash green or red |
| FR-INV-02 | Asset detail with a live chart | Chart updates without dropping frames; 1H / 1D / 1W ranges |
| FR-INV-03 | Connection resilience | Auto-reconnect with backoff; "Reconnecting…" indicator; stale prices marked |
| FR-INV-04 | Throttled UI updates | UI updates at most ~4×/s per asset even if the stream is faster |

### 1.10 Developer Menu (F11) — P0

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-DEV-01 | Hidden entry point | Opened by tapping the app version in Settings 7 times; only available in debug/demo builds |
| FR-DEV-02 | Network simulation | Toggles: normal / slow (2–5 s) / always fail / timeout / offline |
| FR-DEV-03 | Failure rate slider | 0–100% random failure rate for the fake API |
| FR-DEV-04 | Trigger incoming transfer | Button to simulate receiving money |
| FR-DEV-05 | Reset data | Resets the wallet to its seeded state |

### 1.11 Offline Sync — P2

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-SYNC-01 | Queue transfers made offline | Queued with an idempotency key; sent in order when back online; user can cancel before sending |

---

## 2. Non-Functional Requirements

### 2.1 Architecture

| ID | Requirement |
|---|---|
| NFR-ARCH-01 | All money calculations, validation, transaction state transitions and API access live in the KMP shared module. React Native contains **no** business rules. |
| NFR-ARCH-02 | Shared module layers: `domain/` (pure Kotlin, no platform deps), `data/`, `sync/`, `security/`, `bridge/`. `domain/` must not depend on any other layer. |
| NFR-ARCH-03 | Backend access goes through the `WalletApi` interface. Swapping `FakeWalletApi` for a real implementation requires changing only the DI configuration. |
| NFR-ARCH-04 | Kotlin exposes state to React Native as Flows / event streams; React Native subscribes and renders. |
| NFR-ARCH-05 | TypeScript types for bridged APIs are generated or kept in a single file, never duplicated by hand across screens. |

### 2.2 Correctness (money)

| ID | Requirement |
|---|---|
| NFR-MONEY-01 | Money is stored as `Long` minor units (e.g. cents). `Float` and `Double` are never used for amounts. |
| NFR-MONEY-02 | Formatting and parsing happen in one place (`MoneyFormatter`) and are unit-tested, including edge cases (0, max, negative rejected). |
| NFR-MONEY-03 | Balance shown after a successful transaction always equals the server balance after the next refresh. |
| NFR-MONEY-04 | Only valid state transitions are possible (see §3.2); invalid transitions throw in debug and are logged in release. |

### 2.3 Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-01 | Cold start to lock screen | < 2 s on a mid-range Android device (release build) |
| NFR-PERF-02 | Unlock to Home with cached data | < 500 ms |
| NFR-PERF-03 | Scrolling history (500+ items) | Sustained 60fps, no blank cells |
| NFR-PERF-04 | Animations | Run on the UI thread (Reanimated); no dropped frames during transitions |
| NFR-PERF-05 | Live price updates (P2) | No measurable JS frame drops at 4 updates/s across 10 assets |

### 2.4 Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Secrets (PIN hash, tokens) stored only in Keychain (iOS) / Keystore-backed storage (Android). |
| NFR-SEC-02 | No financial data, PINs or tokens in logs, crash reports or analytics. |
| NFR-SEC-03 | Screenshots/screen recording blocked on sensitive screens (Android `FLAG_SECURE`; iOS overlay on capture). |
| NFR-SEC-04 | Network calls use HTTPS only; certificate pinning applied once a real backend exists. |
| NFR-SEC-05 | Local cache (SQLDelight) contains no secrets; cleared on logout. |

### 2.5 Reliability

| ID | Requirement |
|---|---|
| NFR-REL-01 | Every network call has a timeout, and retries use exponential backoff where safe (reads only, or writes with idempotency keys). |
| NFR-REL-02 | The app never crashes on malformed API or QR data; errors map to typed `AppError`s. |
| NFR-REL-03 | App process death during a pending transfer: on relaunch, the pending transaction is shown and its status is rechecked. |

### 2.6 Accessibility & UX

| ID | Requirement |
|---|---|
| NFR-A11Y-01 | All interactive elements have screen-reader labels; amounts read naturally (e.g. "one hundred fifty dollars"). |
| NFR-A11Y-02 | Supports system font scaling up to 200% without clipped text. |
| NFR-A11Y-03 | Color contrast meets WCAG AA; status is never shown by color alone (icon + text too). |
| NFR-A11Y-04 | Light and dark mode. |

### 2.7 Testability & Quality

| ID | Requirement | Target |
|---|---|---|
| NFR-TEST-01 | Unit test coverage, `domain/` | ≥ 90% |
| NFR-TEST-02 | Unit test coverage, shared module overall | ≥ 70% |
| NFR-TEST-03 | Idempotency, state machine and money math have dedicated test suites | Required |
| NFR-TEST-04 | End-to-end flows (Maestro): onboarding, transfer success, transfer failure + retry, offline home | 4 flows minimum |
| NFR-TEST-05 | CI runs lint, tests and both platform builds on every PR | Required |

---

## 3. Data Model & State

### 3.1 Core entities (shared module, `domain/`)

```kotlin
@JvmInline value class Money(val minor: Long)          // e.g. 150000 = 1,500.00

data class Wallet(
    val id: String,
    val balance: Money,
    val dailyLimit: Money,
    val usedToday: Money,
    val updatedAt: Instant,
)

data class Transaction(
    val id: String,
    val idempotencyKey: String,
    val type: TransactionType,        // TRANSFER_OUT, TRANSFER_IN, TOP_UP, QR_PAYMENT
    val amount: Money,
    val counterparty: Counterparty?,  // name, phone or merchant ID
    val note: String?,
    val status: TransactionStatus,
    val failureReason: ErrorCode?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class Contact(val userId: String, val name: String, val phone: String)
```

### 3.2 Transaction state machine

```
Draft ──confirm──▶ Authorizing ──auth ok──▶ Submitting ──200 ok──▶ Success
  ▲                    │                        │
  └─────cancel─────────┘                        ├──error──▶ Failed ──retry (same key)──▶ Submitting
                                                │
                                                └──timeout──▶ Pending ──status check──▶ Success | Failed
Success ──(server reversal)──▶ Reversed
```

Allowed transitions are defined in one place in `domain/` and tested exhaustively. Any transition not shown is invalid.

---

## 4. API Contract (`WalletApi`)

### 4.1 Interface

```kotlin
interface WalletApi {
    suspend fun getWallet(): Wallet
    suspend fun getTransactions(cursor: String?, limit: Int = 20, filter: TxFilter? = null): Page<Transaction>
    suspend fun getTransaction(id: String): Transaction
    suspend fun searchContacts(query: String): List<Contact>
    suspend fun transfer(req: TransferRequest, idempotencyKey: String): Transaction
    suspend fun topUp(req: TopUpRequest, idempotencyKey: String): Transaction
    suspend fun payMerchant(req: QrPaymentRequest, idempotencyKey: String): Transaction
    fun incomingEvents(): Flow<WalletEvent>          // incoming transfers, pending resolutions
}
```

### 4.2 Fake backend behavior (`FakeWalletApi`)

| ID | Requirement |
|---|---|
| FR-FAKE-01 | Seeded with a wallet, 10 contacts and ~200 historical transactions across 60 days |
| FR-FAKE-02 | Same idempotency key + same request → returns the original result, never re-applies |
| FR-FAKE-03 | Same idempotency key + different request → `IDEMPOTENCY_CONFLICT` error |
| FR-FAKE-04 | Latency, failure rate and offline mode controlled by the Developer Menu (FR-DEV-02/03) |
| FR-FAKE-05 | Timed-out transfers resolve to success or failure after 5–20 s and emit a `WalletEvent` |
| FR-FAKE-06 | Balance is derived from ledger entries, not edited directly, so history and balance always agree |
| FR-FAKE-07 | State persists across app restarts (stored locally) and resets via FR-DEV-05 |

### 4.3 Error codes

| Code | User-facing message (draft) | Retryable |
|---|---|---|
| `INSUFFICIENT_FUNDS` | "Your balance isn't enough for this transfer." | No |
| `DAILY_LIMIT_EXCEEDED` | "You've reached today's transfer limit." | No |
| `RECIPIENT_NOT_FOUND` | "We couldn't find this recipient." | No |
| `INVALID_QR` | "This isn't a valid payment code." | No |
| `NETWORK_TIMEOUT` | "This is taking longer than usual. We'll let you know when it's done." | Status check |
| `NETWORK_UNAVAILABLE` | "You're offline. Check your connection and try again." | Yes |
| `SERVER_ERROR` | "Something went wrong on our side. Please try again." | Yes |
| `IDEMPOTENCY_CONFLICT` | "Something went wrong. Please start a new transfer." | No (new key) |

---

## 5. Out of Scope

- Real money, real banking or payment integrations (beyond optional payment sandboxes)
- Real KYC, AML or regulatory compliance
- Multi-currency and FX
- Web, desktop or tablet-optimized layouts
- Real SMS OTP delivery
- Push notifications via APNs/FCM (in-app only for this project)

---

## 6. Definition of Done (per feature)

- [ ] Acceptance criteria met on **both** iOS and Android
- [ ] Business logic in the KMP module, with unit tests
- [ ] Loading, empty, error and offline states designed and implemented
- [ ] Screen-reader labels and font scaling checked
- [ ] No new lint warnings; CI green
- [ ] README or ADR updated if an architectural decision was made
