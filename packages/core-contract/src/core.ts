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

  // ── Data (ADR-0009: fake server DB + the app's local replica) ──────────
  /**
   * FR-DEV-05: re-seed the fake server, clear the local replica, then sync it once (a sync
   * that can't reach the server leaves the replica empty). Defaults to {@link DEFAULT_DATASET}.
   */
  resetData(config?: DatasetConfig): Promise<void>;
  /** From the server (and cached); if unreachable, the cached wallet with `stale`. */
  getWallet(): Promise<Wallet>;
  /**
   * History from the local replica, newest first (FR-HIST-01: default limit 20, no duplicates
   * across pages). The first page (no cursor) refreshes first: it delta-syncs server changes
   * into the replica; if the server is unreachable it returns the replica with `stale`.
   * Rejects only when there is nothing cached to show.
   */
  getTransactions(cursor?: string, limit?: number, filter?: TxFilter): Promise<TransactionPage>;
  /** From the replica, else the server. */
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
  /**
   * Over the local replica. `month` is `YYYY-MM` in the core's time zone; byDay uses local
   * dates; balanceCheck compares the replica's ledger with the server balance last received.
   */
  computeSpendingSummary(month: string): Promise<SpendingSummary>;
  /**
   * BM-04: parse a JSON array of transactions, validate each one and write the valid ones to
   * the local replica (not the server: balances are unaffected). Existing ids are duplicates.
   */
  ingestTransactions(json: string): Promise<IngestResult>;
  /**
   * BM-04b: hands the core a payload to ingest later, as if it had arrived on the core's own
   * side (in a real app, from the network). Not timed by the harness. Replaces any staged
   * payload; resetData leaves it alone.
   */
  stageIngestPayload(json: string): Promise<void>;
  /**
   * BM-04b: ingestTransactions on the staged payload, so no data crosses into the core during
   * the call. The payload stays staged. Throws INVALID_ARGUMENT if nothing is staged.
   */
  ingestStaged(): Promise<IngestResult>;

  // ── Tiny synchronous calls (BM-06) ────────────────────────────────────
  /**
   * Returns its argument and does nothing else: BM-06 times it to get the pure cost of a call
   * (in kmpCore, one JS → Nitro → Kotlin round trip; in jsCore, a plain function call).
   */
  echo(value: number): number;
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
  /**
   * Database time of that same call (reading the replica for a summary, writing it for an
   * ingest). Reported separately because the two builds use different SQLite engines (ADR-0009).
   */
  lastStorageMs(): number;
}

