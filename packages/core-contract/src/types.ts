/**
 * Shared types for both cores.
 *
 * NFR-ARCH-05: bridged types are declared ONCE, here. `core-kmp`'s Nitro spec
 * re-declares them structurally (Nitro needs them in its own spec file), and a
 * compile-time check in `core-kmp/src/index.ts` guarantees the two stay identical.
 *
 * Money (NFR-MONEY-01): amounts are integer minor units (cents). JS has no Long,
 * so they travel as `number` but must always be safe integers. Both cores reject
 * anything else at the boundary. Kotlin stores them as `Long`.
 */

/** Integer minor units (e.g. 150000 = $1,500.00). Always a safe integer. */
export type MinorUnits = number;
/** UTC epoch milliseconds. Always a safe integer. */
export type EpochMillis = number;

export type TransactionType = 'TRANSFER_OUT' | 'TRANSFER_IN' | 'TOP_UP' | 'QR_PAYMENT';

/** Persisted status of a transaction (what History shows). */
export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';

/** Client-side transfer flow state (requirements §3.2). Superset of TransactionStatus. */
export type TransferState =
  | 'DRAFT'
  | 'AUTHORIZING'
  | 'SUBMITTING'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REVERSED';

export type TransferEvent =
  | 'CONFIRM'
  | 'CANCEL'
  | 'AUTH_OK'
  | 'SUBMIT_OK'
  | 'SUBMIT_ERROR'
  | 'TIMEOUT'
  | 'RETRY'
  | 'STATUS_SUCCESS'
  | 'STATUS_FAILED'
  | 'SERVER_REVERSAL';

export type Category =
  | 'FOOD'
  | 'TRANSPORT'
  | 'SHOPPING'
  | 'BILLS'
  | 'ENTERTAINMENT'
  | 'TRANSFER'
  | 'TOP_UP';

/**
 * requirements §4.3, plus contract-level codes: NOT_FOUND, INVALID_ARGUMENT, and
 * SECURE_STORAGE_UNAVAILABLE (ADR-0010: secure storage can't be used right now, e.g. the device
 * is locked; nothing was wiped, stay locked and retry).
 */
export type ErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'DAILY_LIMIT_EXCEEDED'
  | 'RECIPIENT_NOT_FOUND'
  | 'INVALID_QR'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_UNAVAILABLE'
  | 'SERVER_ERROR'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'SECURE_STORAGE_UNAVAILABLE';

export type CounterpartyKind = 'USER' | 'MERCHANT' | 'PAYMENT_METHOD';

export interface Counterparty {
  kind: CounterpartyKind;
  id: string;
  name: string;
  phone?: string;
}

/**
 * Present when data came from the local replica because the server couldn't be reached
 * (FR-HIST-04, product §6.3 "Last updated hh:mm" + offline banner). ADR-0009.
 */
export interface StaleInfo {
  /** Why the server wasn't used: NETWORK_UNAVAILABLE, NETWORK_TIMEOUT or SERVER_ERROR. */
  reason: ErrorCode;
  /** When the cached data was last synced from the server. */
  cachedAt: EpochMillis;
}

export interface Wallet {
  id: string;
  balance: MinorUnits;
  dailyLimit: MinorUnits;
  usedToday: MinorUnits;
  updatedAt: EpochMillis;
  stale?: StaleInfo;
}

export interface Transaction {
  id: string;
  idempotencyKey: string;
  type: TransactionType;
  /** Spending category. Not in requirements §3.1; added for BM-03 grouping (see ADR-0004). */
  category: Category;
  amount: MinorUnits;
  counterparty?: Counterparty;
  note?: string;
  status: TransactionStatus;
  failureReason?: ErrorCode;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}

export interface TransactionPage {
  items: Transaction[];
  /** Opaque. Absent on the last page. */
  nextCursor?: string;
  /** First page only: the refresh couldn't reach the server, so this is the replica as last synced. */
  stale?: StaleInfo;
}

export interface TxFilter {
  types?: TransactionType[];
  statuses?: TransactionStatus[];
}

export interface CategoryTotal {
  category: Category;
  total: MinorUnits;
  count: number;
}

export interface DayTotal {
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: string;
  spent: MinorUnits;
  income: MinorUnits;
}

export interface BalanceCheck {
  ledgerBalance: MinorUnits;
  walletBalance: MinorUnits;
  consistent: boolean;
}

export interface SpendingSummary {
  /** `YYYY-MM` (UTC). */
  month: string;
  totalSpent: MinorUnits;
  totalIncome: MinorUnits;
  net: MinorUnits;
  /** Every transaction created in the month, any status. */
  transactionCount: number;
  /** Successful outgoing only. Sorted by total desc, then category asc. */
  byCategory: CategoryTotal[];
  /** Days with successful activity only. Sorted by date asc. */
  byDay: DayTotal[];
  balanceCheck: BalanceCheck;
}

export type IngestRejectReason =
  | 'INVALID_SHAPE'
  | 'INVALID_ID'
  | 'INVALID_TYPE'
  | 'INVALID_CATEGORY'
  | 'INVALID_AMOUNT'
  | 'INVALID_STATUS'
  | 'INVALID_FAILURE_REASON'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_COUNTERPARTY'
  | 'INVALID_NOTE';

export interface IngestError {
  index: number;
  reason: IngestRejectReason;
}

export interface IngestResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  /** First {@link MAX_INGEST_ERRORS} rejections, in input order. */
  errors: IngestError[];
}

export type MoneyParseError =
  | 'EMPTY'
  | 'NEGATIVE'
  | 'TOO_MANY_DECIMALS'
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE';

export interface MoneyParseResult {
  ok: boolean;
  minor?: MinorUnits;
  error?: MoneyParseError;
}

export interface PriceTick {
  symbol: string;
  price: MinorUnits;
  /** Change vs previous tick, in basis points (-50..50). */
  changeBps: number;
  /** 1-based tick number within the subscription. */
  seq: number;
}

export interface PriceStreamOptions {
  intervalMs?: number;
  seed?: number;
}

export interface Subscription {
  unsubscribe(): void;
}

/** FR-DEV-02: how the fake backend behaves. */
export type NetworkMode = 'NORMAL' | 'SLOW' | 'ALWAYS_FAIL' | 'TIMEOUT' | 'OFFLINE';

export interface NetworkSimulation {
  mode: NetworkMode;
  /** FR-DEV-03: 0–100. In NORMAL/SLOW, each call fails with SERVER_ERROR at this rate. */
  failureRatePercent: number;
  /** Fixed latency in NORMAL mode (BM-07 uses 300). 0–60000. Default 0. */
  normalLatencyMs?: number;
  /**
   * Client-side read timeout (NFR-REL-01), 100–60000. Default READ_TIMEOUT_MS (10 s).
   * A latency above it produces a *late* response, which must have no effect (ADR-0007).
   */
  readTimeoutMs?: number;
  /**
   * Client-side timeout for a transfer submission (FR-TRF-09), 100–60000. Default
   * TRANSFER_TIMEOUT_MS (15 s). After it the transfer is PENDING; the server may still apply
   * it, and a status check finds out (ADR-0007, ADR-0014).
   */
  writeTimeoutMs?: number;
  /** Seed for the latency/failure draws, so both cores produce the same sequence. Default 1. */
  seed?: number;
}

/** The generated part of a dataset. Split out so core-kmp can bridge it on its own. */
export interface DatasetSeed {
  seed: number;
  /** Total ledger entries, including the opening top-up. Must be >= 1. */
  transactionCount: number;
  /**
   * When set, the fake backend's clock is FROZEN at this instant, so datasets and results
   * are reproducible (tests, golden fixtures, benchmarks: BM-PAR-04). When absent, the
   * backend follows the device clock and data is seeded relative to "now" (the app).
   */
  nowMillis?: EpochMillis;
}

/** The fake server's dataset. Extra seed rows are benchmark/test-only: BenchCore.resetDataWithExtras. */
export type DatasetConfig = DatasetSeed;

// ── Auth & App Lock (F1, F2; ADR-0010) ──────────────────────────────────

/** FR-AUTH-03: why a candidate PIN is refused. */
export type PinRejectReason = 'NOT_DIGITS' | 'WRONG_LENGTH' | 'TOO_SIMPLE';

export interface PinCheck {
  ok: boolean;
  /** Set when `ok` is false. */
  reason?: PinRejectReason;
}

/**
 * FR-LOCK-04. LOCKED_OUT also covers the attempt that triggers the lockout; while locked out
 * the PIN isn't checked at all.
 */
export type UnlockOutcome = 'UNLOCKED' | 'WRONG_PIN' | 'LOCKED_OUT';

export interface UnlockResult {
  outcome: UnlockOutcome;
  /** Wrong attempts left before a lockout. PIN_MAX_ATTEMPTS after UNLOCKED, 0 when LOCKED_OUT. */
  attemptsLeft: number;
  /** Device-clock end of the lockout; set only when LOCKED_OUT. */
  lockedUntil?: EpochMillis;
}

/** What the lock screen needs on start. Read from secure storage, so it survives force-closing. */
export interface AuthState {
  /** FR-AUTH-02: the phone verified by OTP on this install (E.164). Absent: onboarding starts there. */
  phone?: string;
  pinSet: boolean;
  /** Wrong attempts since the last unlock or lockout (0..PIN_MAX_ATTEMPTS-1). */
  failedAttempts: number;
  /** Set while a lockout is running. */
  lockedUntil?: EpochMillis;
}

// ── Biometrics (FR-AUTH-04, later FR-TRF-04; ADR-0012) ──────────────────

export type BiometricKind = 'FINGERPRINT' | 'FACE' | 'IRIS' | 'OTHER';

/** Why biometrics can't be used. Only strong (Class 3) biometrics count. */
export type BiometricUnavailableReason = 'NO_HARDWARE' | 'NOT_ENROLLED' | 'NOT_STRONG' | 'TEMPORARILY_UNAVAILABLE';

export interface BiometricStatus {
  /** The device can sign with a strong biometric right now. */
  available: boolean;
  reason?: BiometricUnavailableReason;
  kind?: BiometricKind;
  /** The user turned biometric unlock on (a key and its public key exist). */
  enabled: boolean;
}

/** What the system prompt says. The cancel button is how the user gets to the PIN. */
export interface BiometricPromptText {
  title: string;
  subtitle?: string;
  cancel: string;
}

/**
 * enableBiometrics. WRONG_PIN / PIN_LOCKED_OUT: the PIN check failed (counted like verifyPin).
 * CANCELLED / BIOMETRIC_LOCKED_OUT / UNAVAILABLE: the confirming scan didn't happen; nothing
 * was enabled. NOT_AVAILABLE: no strong biometric on this device.
 */
export type BiometricEnableOutcome =
  | 'ENABLED'
  | 'WRONG_PIN'
  | 'PIN_LOCKED_OUT'
  | 'CANCELLED'
  | 'BIOMETRIC_LOCKED_OUT'
  | 'NOT_AVAILABLE'
  | 'UNAVAILABLE';

export interface BiometricEnableResult {
  outcome: BiometricEnableOutcome;
  /** WRONG_PIN only. */
  attemptsLeft?: number;
  /** PIN_LOCKED_OUT only. */
  lockedUntil?: EpochMillis;
}

/**
 * unlockWithBiometrics.
 * - UNLOCKED: a fresh challenge was signed by the biometric key and verified.
 * - CANCELLED: the user chose the PIN (or the system dismissed the prompt).
 * - BIOMETRIC_LOCKED_OUT: the OS locked biometrics after failed scans; use the PIN.
 * - KEY_INVALIDATED: biometrics changed (enrolled, removed, screen lock removed); biometric
 *   unlock was turned off and the PIN is needed to turn it on again.
 * - FAILED: the signature didn't verify (an old or forged answer): turned off. Also an answer
 *   that came after BIOMETRIC_CHALLENGE_TTL_MS: left on, since that's a slow user.
 * - UNAVAILABLE: temporarily can't be used (e.g. device locked); nothing changed.
 */
export type BiometricUnlockOutcome =
  | 'UNLOCKED'
  | 'CANCELLED'
  | 'BIOMETRIC_LOCKED_OUT'
  | 'KEY_INVALIDATED'
  | 'FAILED'
  | 'UNAVAILABLE';

export interface BiometricUnlockResult {
  outcome: BiometricUnlockOutcome;
  /**
   * UNLOCKED during a PIN lockout. The lockout and its counter stay as they are; the app tells
   * the user someone entered wrong PINs.
   */
  pinLockedOut: boolean;
}

// ── Phone + OTP onboarding (FR-AUTH-01/02; ADR-0013) ────────────────────

/** FR-AUTH-01: why a phone number is refused. Indonesia (+62) mobile numbers only. */
export type PhoneRejectReason = 'NOT_DIGITS' | 'NOT_MOBILE' | 'TOO_SHORT' | 'TOO_LONG';

export interface PhoneCheck {
  ok: boolean;
  /** E.164, e.g. "+6281234567890"; set when ok. */
  e164?: string;
  reason?: PhoneRejectReason;
}

/** requestOtp. TOO_SOON: a code was sent less than OTP_RESEND_MS ago; nothing was sent. */
export type OtpSendOutcome = 'SENT' | 'TOO_SOON';

export interface OtpSendResult {
  outcome: OtpSendOutcome;
  /** When "Resend" may be used. */
  resendAt: EpochMillis;
}

/**
 * verifyOtp (counted by the server, as a real backend would).
 * - VERIFIED: the phone is now this install's verified phone (secure storage); the PIN comes next.
 * - WRONG_CODE: `attemptsLeft` before a cooldown.
 * - COOLDOWN: OTP_MAX_ATTEMPTS wrong codes; no code is checked until `retryAt`.
 * - EXPIRED / NO_CODE: request a new code.
 */
export type OtpVerifyOutcome = 'VERIFIED' | 'WRONG_CODE' | 'COOLDOWN' | 'EXPIRED' | 'NO_CODE';

export interface OtpVerifyResult {
  outcome: OtpVerifyOutcome;
  /** WRONG_CODE only. */
  attemptsLeft?: number;
  /** COOLDOWN only. */
  retryAt?: EpochMillis;
}

// ── P2P transfer (F5, FR-TRF-01..11; ADR-0014) ──────────────────────────

/** requirements §3.1. A Pocketly user the wallet can send to. `phone` is E.164. */
export interface Contact {
  userId: string;
  name: string;
  phone: string;
}

/**
 * FR-TRF-01, for a typed phone number (the query passes checkPhone): FOUND (it's in
 * `contacts`), NOT_FOUND (no Pocketly account uses it), or SELF (the verified phone of this
 * install: can't be selected).
 */
export type PhoneLookup = 'FOUND' | 'NOT_FOUND' | 'SELF';

export interface ContactSearch {
  /** Empty query only: people this wallet sent to, most recent first (from the replica). */
  recent: Contact[];
  /** Matches by name (case-insensitive substring) or phone, sorted by name; never this user. */
  contacts: Contact[];
  /** Set when the query is a complete phone number. */
  phoneLookup?: PhoneLookup;
}

/** startTransfer: a recipient picked, with the limits the amount step needs (FR-TRF-02/10). */
export interface TransferDraft {
  recipient: Contact;
  /** Fresh from the server: a draft is never built from cached data (FR-TRF-11). */
  balance: MinorUnits;
  /** dailyLimit − usedToday, never negative. */
  dailyRemaining: MinorUnits;
  /** TRANSFER_MIN_MINOR. */
  minAmount: MinorUnits;
  /** min(balance, dailyRemaining). Below minAmount: nothing can be sent today. */
  maxAmount: MinorUnits;
}

/**
 * checkTransferAmount. The money parse errors (MoneyParseError's names, spelled out: Nitro needs
 * one flat union), then for a parsed amount BELOW_MINIMUM, INSUFFICIENT_FUNDS,
 * DAILY_LIMIT_EXCEEDED, checked in that order.
 */
export type AmountRejectReason =
  | 'EMPTY'
  | 'NEGATIVE'
  | 'TOO_MANY_DECIMALS'
  | 'INVALID_FORMAT'
  | 'OUT_OF_RANGE'
  | 'BELOW_MINIMUM'
  | 'INSUFFICIENT_FUNDS'
  | 'DAILY_LIMIT_EXCEEDED';

export interface AmountCheck {
  ok: boolean;
  /** Set when the text parses, even if the amount is refused. */
  minor?: MinorUnits;
  reason?: AmountRejectReason;
  /**
   * FR-TRF-02 "invalid input blocked as typed": false when no amount can start with this text
   * (INVALID_FORMAT, TOO_MANY_DECIMALS, NEGATIVE, OUT_OF_RANGE). The keypad drops that
   * keystroke. EMPTY and the limit reasons keep the text and show a message.
   */
  acceptInput: boolean;
  /** balance − minor, when the text parses: the live "remaining balance". */
  remainingBalance?: MinorUnits;
}

/** reviewTransfer (FR-TRF-03): what the user confirms. The idempotency key exists from here on. */
export interface TransferReview {
  /** The attempt's id (FR-TRF-05: one attempt, one key). Pass it to confirmTransfer. */
  id: string;
  idempotencyKey: string;
  recipient: Contact;
  amount: MinorUnits;
  /** TRANSFER_FEE_MINOR: always 0 for now (product §6.1). */
  fee: MinorUnits;
  note?: string;
  balanceAfter: MinorUnits;
}

export type TransferAuthMethod = 'BIOMETRIC' | 'PIN';

/** How the first confirmTransfer of an attempt is authorized (FR-TRF-04). */
export interface TransferAuth {
  method: TransferAuthMethod;
  /** PIN only. Checked and counted like verifyPin (FR-LOCK-04). */
  pin?: string;
  /** BIOMETRIC only: the system prompt's text. */
  prompt?: BiometricPromptText;
}

/**
 * Whether confirmTransfer's authorization passed. Anything but OK leaves the attempt in DRAFT
 * with nothing sent (FR-TRF-04: cancel returns to review without side effects).
 * - CANCELLED: the user dismissed the biometric prompt (or chose the PIN).
 * - WRONG_PIN / PIN_LOCKED_OUT: as verifyPin's WRONG_PIN / LOCKED_OUT.
 * - BIOMETRIC_LOCKED_OUT, KEY_INVALIDATED, FAILED, UNAVAILABLE: as unlockWithBiometrics
 *   (KEY_INVALIDATED and FAILED turned biometrics off); use the PIN.
 * - NOT_REQUIRED: a retry of a FAILED attempt (no new authorization; same key, same approval).
 */
export type TransferAuthOutcome =
  | 'OK'
  | 'NOT_REQUIRED'
  | 'CANCELLED'
  | 'WRONG_PIN'
  | 'PIN_LOCKED_OUT'
  | 'BIOMETRIC_LOCKED_OUT'
  | 'KEY_INVALIDATED'
  | 'FAILED'
  | 'UNAVAILABLE';

/**
 * confirmTransfer / getTransferStatus. `state` follows requirements §3.2:
 * - DRAFT: not authorized (see `auth`); nothing was sent.
 * - SUCCESS: `transaction` is the server's.
 * - FAILED: `failureReason` and `retryable` (FR-TRF-08); the balance is as before.
 * - PENDING: no answer within writeTimeoutMs (FR-TRF-09). `transaction` is the pending row
 *   History shows; getTransferStatus resolves it.
 */
export interface TransferResult {
  id: string;
  state: TransferState;
  auth: TransferAuthOutcome;
  transaction?: Transaction;
  failureReason?: ErrorCode;
  /** FAILED only: confirmTransfer(id) may try again with the same key. */
  retryable?: boolean;
  /** WRONG_PIN only. */
  attemptsLeft?: number;
  /** PIN_LOCKED_OUT only. */
  lockedUntil?: EpochMillis;
  /** The wallet balance the result implies (SUCCESS, FAILED, PENDING). */
  balance?: MinorUnits;
}
