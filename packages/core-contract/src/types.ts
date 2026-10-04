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

export interface Wallet {
  id: string;
  balance: MinorUnits;
  dailyLimit: MinorUnits;
  usedToday: MinorUnits;
  updatedAt: EpochMillis;
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

export interface DatasetConfig {
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
