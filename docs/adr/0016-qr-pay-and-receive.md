# ADR-0016: QR Pay and My QR: one payment pipeline, codes that carry only IDs

**Status:** Accepted · 2026-10-30 · Implements F7, F8 (FR-QR-01..05) · Builds on ADR-0012, ADR-0014, ADR-0015

## Context

F7 pays a merchant from a scanned QR code; F8 shows the user's own code, which another Pocketly
user scans to send them money. FR-QR-04 asks QR payments to reuse the transfer pipeline, as
ADR-0015 did for top-ups. FR-QR-02 puts parsing and validation in the core, and NFR-REL-02 says
malformed QR data never crashes the app. The requirements leave the payload format to us (an
app-defined JSON/URI scheme, not a national standard).

A QR code is **untrusted input**: anyone can print one, or stick one over a real merchant's.
Whatever the code says, the user must see who they pay and how much from a source we trust.

Each bridged method or type costs kmpCore ~18 KB of bridge library (ADR-0002, BM-08
`2026-10-30_mid-01`), so the contract stays coarse.

## Decisions

### 1. One payment pipeline, three kinds; the contract keeps its names

The core's attempt pipeline (TransferFlow, ADR-0014) already carries a kind since ADR-0015:
`TRANSFER`, `TOP_UP`, and now `QR_PAYMENT`. Inside both cores it is renamed **PaymentFlow**, and
each kind supplies its request, its pending-row placeholder, its wallet deltas and its approval
message. The state machine (requirements §3.2), the idempotency key, the 15 s write timeout,
the status check and the result shape are shared and unchanged.

The **contract** keeps `confirmTransfer`, `getTransferStatus`, `TransferResult` and
`TransferState`. Renaming them to "payment" would touch both cores, the bridge, every Send screen
and the fixtures for no behavior change and no size change, and requirements §3.2 already calls
this "the transaction state machine". Their documentation says they take any kind of attempt.

| Kind | Approval (first confirm) | Wallet while PENDING | Wallet on SUCCESS | Counts toward the daily limit |
|---|---|---|---|---|
| TRANSFER | PIN or biometrics | −amount, +used | −amount, +used | yes |
| QR_PAYMENT | PIN or biometrics (FR-QR-04: as transfers) | −amount, +used | −amount, +used | yes (the server's `usedSince` already counts QR_PAYMENT) |
| TOP_UP | none (ADR-0015 §2) | nothing | +amount | no |

### 2. Every signed kind has its own versioned first line

Biometric approval signs a message whose first line names its kind (ADR-0012), so a signature
for one kind can never pass as another. Today: `pocketly:unlock:v1`, `pocketly:transfer:v1`.
New:

```
pocketly:qrpay:v1
amount:<minor units>
merchant:<merchantId>
request:<requestId, or "-" for a static code>
idempotencyKey:<key>
```

Top-ups sign nothing (ADR-0015 §2), so there's no `topup` line; if top-ups ever need approval,
they get `pocketly:topup:v1` then. `fixtures/biometric.json` gains a `qrpay` message with its
signature, plus **cross-kind rejections**: the fixture's transfer signature checked against the
qrpay message, and the qrpay signature against the transfer message, must both fail in both
cores.

### 3. The payload: a versioned URI that carries only IDs

```
pocketly://pay/v1?m=<merchantId>                  static merchant code: the payer types the amount
pocketly://pay/v1?m=<merchantId>&r=<requestId>    dynamic code: the amount is the request's
pocketly://user/v1?u=<userId>                     My QR (F8): pay this Pocketly user
```

- **IDs only.** A code never carries a merchant name, a person's name or phone number, or an
  amount. Names and amounts come from the server (§4), so a printed code can't make a shop look
  like another one or change what a dynamic code charges, and photographing someone's My QR
  reveals no personal data.
- **Strict parsing**, in both cores against one fixture (`fixtures/qr.json`): at most 256
  characters; exactly these schemes, hosts and versions (`v2` is UNSUPPORTED_VERSION, not
  "maybe fine"); IDs `[A-Za-z0-9-]{1,32}`, so nothing needs percent-decoding; no repeated, missing
  or unknown parameters; no fragment. Anything else is a refusal with a reason, never an
  exception: the parser is total (NFR-REL-02). Amount edge cases (negative, three decimals)
  can't arise because codes carry no amount.
- **Not a deep link.** `pocketly://` is also the developer links' scheme (ADR-0008), but a
  scanned code is only ever parsed as text; the app doesn't register `pay` or `user` as
  routes, so tapping such a link elsewhere does nothing.

### 4. The server is the source of truth for names, amounts and expiry

- **Static code:** `startQrPayment(merchantId)` looks the merchant up (the seeded merchants
  `m-01`..`m-10` become the server's merchant directory). Unknown → INVALID_QR (FR-QR-02 "unknown
  payload").
- **Dynamic code:** the server holds the **payment request** (`r`): merchant, amount, expiry
  and whether it was paid. `startQrPayment(merchantId, requestId)` returns its amount, locked
  (FR-QR-03). Expired → new code `QR_EXPIRED`; already paid → new code `QR_ALREADY_PAID`; a
  request for another merchant → INVALID_QR.
- **One payment per request**, enforced by the server, not by reusing the request ID as the
  idempotency key. Keys stay one per attempt (UUID v4, as transfers), so a refusal that isn't
  final for the request (INSUFFICIENT_FUNDS: top up, scan again) doesn't burn the code. The server
  marks the request paid when a payment for it succeeds (or is held PENDING); another key for a
  paid request is QR_ALREADY_PAID; the same key returns the original transaction (FR-FAKE-02).
- **The fake server's requests:** seeded deterministically (an open one, an expired one, a paid
  one, at Corner Coffee and Noodle House), and the developer menu / `pocketly://dev/payrequest`
  creates new ones. Server schema version 4: `server_payment_request`, and a `request_id` column
  on `server_transfer_key` so the idempotency check compares it too.

### 5. The contract: four methods

| Method | Does | Rejects with |
|---|---|---|
| `parseQr(text)` | **Synchronous**, no server: `QrCode` { ok, reason?, kind? (MERCHANT, USER), merchantId?, requestId?, userId? }. Reasons: TOO_LONG, MALFORMED, UNSUPPORTED_VERSION, UNKNOWN_KIND | nothing (total) |
| `startQrPayment(merchantId, requestId?)` | Fresh wallet and the merchant (and request) from the server: `QrPaymentDraft` { merchant, amount? (dynamic: locked), expiresAt?, balance, dailyRemaining, minAmount, maxAmount }. Becomes the current draft, so `checkTransferAmount` checks a static code's typed amount with the same limits | NETWORK_*, INVALID_QR, QR_EXPIRED, QR_ALREADY_PAID |
| `reviewQrPayment(amount)` | Creates the attempt and its key: `QrPaymentReview` { id, idempotencyKey, merchant, amount, fee, balanceAfter, requestId? }. A dynamic code's amount must equal the request's | NOT_FOUND (no draft), INVALID_ARGUMENT, INSUFFICIENT_FUNDS, DAILY_LIMIT_EXCEEDED |
| `getMyQr()` | F8: this account's `pocketly://user/v1?u=…` | NETWORK_* (first time only, see §6) |

Confirming, retrying and checking reuse `confirmTransfer` / `getTransferStatus` (§1). A scanned
**user** code needs no new method: the app calls `startTransfer(userId)`, the Send flow follows,
and `startTransfer` already refuses this install's own account (INVALID_ARGUMENT) and unknown
users (RECIPIENT_NOT_FOUND). New contract types: `QrCode`, `QrKind`, `QrRejectReason`,
`QrPaymentDraft`, `QrPaymentReview`; new ErrorCodes `QR_EXPIRED`, `QR_ALREADY_PAID`. At ~18 KB
each that is roughly +160 KB of kmpCore bridge (BM-08 will say).

### 6. My QR (F8)

- **Whose ID:** the fake server gives the account a **random** user ID when the phone is verified
  (OTP, ADR-0013): `u-` + 12 hex digits, kept with that phone (verifying it again keeps the ID)
  and across dataset resets. A hash of the phone would reveal nothing in theory, but phone numbers
  are few enough to enumerate, so any function of the phone could be reversed; a random ID can't.
  `verifyOtp` returns it and the core keeps it in the secure session with the phone (cleared with
  it by `resetAuth` / `logout`); a session from before this asks the server once (`getMyQr`). Scanning your own code: `parseQr`
  gives USER, `startTransfer` refuses it, and the scanner says "That's your own code".
- **Rendering** is UI: `qrcode-generator` (pure JS) computes the modules and the app draws them
  with the `react-native-svg` it already ships, so no new native code. Both builds use it.
- **Brightness** (FR-QR-05) needs a native API: a small in-repo module next to
  `native-secure-screen`. Android raises the activity window's `screenBrightness` (no permission,
  only this window, gone when the screen closes); iOS sets `UIScreen.main.brightness` and
  restores the previous value on close and whenever the app leaves the foreground (re-raising it
  on return). My QR is a modal (product §7.4).

### 7. The scanner (FR-QR-01)

- **The platform's own scanner, one shot**: `react-native-data-scanner` (Nitro-based, as the
  bridge). Pay opens it at once; it returns one code or an error. Both builds use it (it's UI).
  Chosen over VisionCamera 5, which now needs three packages (camera, barcode scanner,
  nitro-image) for the same job.
- **Android:** Google's code scanner from Play services (`play-services-code-scanner`). Its UI
  and model come with Play services, so the APK grows by little and **no camera permission** is
  needed: the app never sees the camera. BM-08 records what it added, in both builds equally.
- **iOS:** VisionKit's DataScannerViewController (iOS 16+), which asks for camera access the
  first time (`NSCameraUsageDescription`). Without access, or on a device that can't scan, the
  library reports an error; the scanner screen says so, with **Open Settings** when access is
  the fix (FR-QR-01). The simulator has no camera, so it always takes that path.
- **Camera only while scanning** (product §7.3 rule 1) holds by construction: the system UI owns
  the camera and closes when it returns.
- **One code per scan:** an invalid or refused code is explained on the scanner screen with
  **Scan again**, instead of over a live camera. Offline, scanning and parsing work, and the flow
  stops at `startQrPayment` with the offline message (as FR-TRF-11).
- **Testing without a camera:** `pocketly://dev/scan?code=<url-encoded payload>` (dev builds
  only, ADR-0008) opens the scanner screen with that code instead of the camera, for Maestro and
  the device check; Jest mocks the library. The device check also scans real codes shown on
  another screen.

### 8. The flow in the app

Pay → scanner → `parseQr` → merchant: `startQrPayment` → amount (static: keypad with
`checkTransferAmount`; dynamic: shown, locked) → review (merchant name from the server, "Pay
<amount> to <merchant>") → PIN or biometrics → processing → result, reusing the Send flow's
components. User code → the Send flow's amount step. Invalid code → "This isn't a valid payment
code" with Scan again. The PIN screen is the Send flow's, shared by both kinds of payment.

## Consequences

- `fixtures/qr.json` (payloads and parse results, server steps for payment requests) and new
  cases in `fixtures/biometric.json`; both cores test against them.
- Server schema 4; ADR-0015's key table gains `request_id`.
- New dependencies: `react-native-data-scanner` 0.1.2, `qrcode-generator` 2.0.4, and the in-repo
  `@pocketly/native-screen-brightness` module.
- BM-08 measures the bridge growth and the scanner library separately.

## Limits

- Merchant codes aren't signed: the server lookup stops name and amount spoofing, but a sticker
  pointing at another real merchant still works, as in real QR schemes without signed codes.
- Same as ADR-0014: in-process fake server; payment requests are created locally, not by a
  merchant system.
