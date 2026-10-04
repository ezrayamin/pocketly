import type {
  DatasetConfig,
  IngestResult,
  MinorUnits,
  MoneyParseResult,
  NetworkSimulation,
  PriceStreamOptions,
  PriceTick,
  SpendingSummary,
  Subscription,
  Transaction,
  TransactionPage,
  TxFilter,
  Wallet,
} from './types';

export type CoreImpl = 'js' | 'kmp';

/**
 * The business core. The UI talks to this and nothing else.
 *
 * Two implementations exist (`core-js`, `core-kmp`) and one is picked at bundle
 * time (`CORE_IMPL`). Both must pass `runContractSuite` (BM-PAR-01).
 *
 * Async methods reject with a {@link CoreError}.
 */
export interface Core {
  readonly impl: CoreImpl;

  // ── Data / fake backend ────────────────────────────────────────────────
  /** Re-seed the fake backend (FR-DEV-05). Defaults to {@link DEFAULT_DATASET}. */
  resetData(config?: DatasetConfig): Promise<void>;
  getWallet(): Promise<Wallet>;
  /** Newest first. FR-HIST-01: default limit 20, no duplicates across pages. */
  getTransactions(cursor?: string, limit?: number, filter?: TxFilter): Promise<TransactionPage>;
  getTransaction(id: string): Promise<Transaction>;

  // ── Developer menu / fake backend controls (F11) ──────────────────────
  /**
   * FR-DEV-02/03, FR-FAKE-04: applies to every backend call (getWallet, getTransactions,
   * getTransaction). Calls give up after `readTimeoutMs` with NETWORK_TIMEOUT; a response
   * arriving after that is discarded and has no effect (ADR-0007).
   * Starts as NETWORK_NORMAL; resetData leaves it alone. Throws INVALID_ARGUMENT for bad values.
   */
  setNetworkSimulation(simulation: NetworkSimulation): void;
  getNetworkSimulation(): NetworkSimulation;
  /** FR-DEV-04: the fake backend receives a deterministic incoming transfer, now. */
  simulateIncomingTransfer(): Promise<Transaction>;

  // ── Time (ADR-0006) ───────────────────────────────────────────────────
  /**
   * IANA zone (e.g. "Asia/Jakarta") for everything calendar-based: the daily-limit day
   * (Wallet.usedToday), and month/day boundaries in computeSpendingSummary.
   * Defaults to "UTC". Throws INVALID_ARGUMENT for an unknown zone.
   */
  setTimeZone(zoneId: string): void;

  // ── CPU-heavy work (BM-03, BM-04) ─────────────────────────────────────
  /** `month` is `YYYY-MM` in the core's time zone; byDay uses local dates. */
  computeSpendingSummary(month: string): Promise<SpendingSummary>;
  /** Parse a JSON array of transactions, validate each one and add the valid ones to the ledger. */
  ingestTransactions(json: string): Promise<IngestResult>;

  // ── Tiny synchronous calls (BM-06) ────────────────────────────────────
  formatMoney(minor: MinorUnits): string;
  formatMoneyBatch(minors: MinorUnits[]): string[];
  parseMoney(input: string): MoneyParseResult;

  // ── Streams (BM-05, NFR-ARCH-04) ──────────────────────────────────────
  subscribePrices(
    symbols: string[],
    onTicks: (ticks: PriceTick[]) => void,
    options?: PriceStreamOptions,
  ): Subscription;

  // ── Benchmark harness ─────────────────────────────────────────────────
  /**
   * Time spent *inside* the core by the most recent computeSpendingSummary,
   * ingestTransactions or formatMoneyBatch call (benchmarking.md §5.2).
   * For kmpCore, this is measured in Kotlin, so end-to-end minus this = bridge overhead.
   */
  lastComputeMs(): number;
}

