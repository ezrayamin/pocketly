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

/** requirements §4.3, plus two contract-level codes (NOT_FOUND, INVALID_ARGUMENT). */
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
  | 'INVALID_ARGUMENT';

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

export interface DatasetConfig extends DatasetSeed {
  /**
   * Extra transactions the fake server is seeded with, on top of the generated ones (tests,
   * demos). Validated like ingest input; any invalid entry rejects the reset (INVALID_ARGUMENT).
   */
  extraTransactions?: Transaction[];
}

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
  pinSet: boolean;
  /** Wrong attempts since the last unlock or lockout (0..PIN_MAX_ATTEMPTS-1). */
  failedAttempts: number;
  /** Set while a lockout is running. */
  lockedUntil?: EpochMillis;
}
