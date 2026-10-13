import type {
  AuthState,
  BiometricEnableResult,
  BiometricPromptText,
  BiometricStatus,
  BiometricUnlockResult,
  DatasetConfig,
  IngestResult,
  MinorUnits,
  MoneyParseResult,
  NetworkSimulation,
  OtpSendResult,
  OtpVerifyResult,
  PhoneCheck,
  PinCheck,
  PriceStreamOptions,
  PriceTick,
  SpendingSummary,
  Subscription,
  Transaction,
  TransactionPage,
  TxFilter,
  UnlockResult,
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

  // ── Auth & App Lock (F1, F2; ADR-0010) ────────────────────────────────
  // Every async auth call rejects with SECURE_STORAGE_UNAVAILABLE when secure storage can't be
  // used right now (device locked, Keystore busy). Nothing was wiped: stay locked, retry later.
  /** FR-AUTH-03: six ASCII digits, not all the same, not a straight run (123456, 987654). */
  checkPin(pin: string): PinCheck;
  /**
   * FR-AUTH-03/05: stores a salted PBKDF2 record of the PIN in secure storage, replacing any
   * previous one, and clears the attempt counter. Throws INVALID_ARGUMENT if checkPin refuses it,
   * NOT_FOUND if no phone has been verified yet (verifyOtp).
   */
  setPin(pin: string): Promise<void>;
  /**
   * FR-LOCK-01/04. The attempt is counted in secure storage *before* hashing, so force-closing
   * the app mid-check can't undo it. Hashing runs off the JS thread. Throws NOT_FOUND if no PIN
   * is set.
   */
  verifyPin(pin: string): Promise<UnlockResult>;
  getAuthState(): Promise<AuthState>;
  /**
   * "Reset onboarding" (developer menu, BM-11): deletes every secret the core holds. The local
   * replica stays; use {@link logout} when a person leaves the app.
   */
  resetAuth(): Promise<void>;
  /**
   * NFR-SEC-05 logout, also "Forgot PIN": clears the local replica (history, wallet, sync
   * state), then does resetAuth. A sync or fetch still in flight writes nothing afterwards.
   * The install id stays (ADR-0010). If secure storage fails, the replica is already empty and
   * the secrets are untouched: retry.
   */
  logout(): Promise<void>;
  /**
   * FR-LOCK-02: how long the app may stay in the background before it locks again. Kept in
   * secure storage with the PIN (ADR-0005); DEFAULT_AUTO_LOCK_MS until set, and after resetAuth.
   */
  getAutoLockTimeout(): Promise<number>;
  /** 0..MAX_AUTO_LOCK_MS, whole milliseconds; anything else is INVALID_ARGUMENT. */
  setAutoLockTimeout(ms: number): Promise<void>;

  // ── Phone + OTP onboarding (FR-AUTH-01/02; ADR-0013) ──────────────────
  /** FR-AUTH-01: an Indonesian mobile number as typed (a leading 0 is allowed and dropped). */
  checkPhone(nationalNumber: string): PhoneCheck;
  /** Asks the (fake) server for a code. INVALID_ARGUMENT if checkPhone refuses the number. */
  requestOtp(phone: string): Promise<OtpSendResult>;
  /**
   * FR-AUTH-02. On VERIFIED the phone becomes this install's verified phone (secure storage);
   * setPin is refused (NOT_FOUND) until then. resetAuth forgets it, so "Forgot PIN" starts here.
   */
  verifyOtp(phone: string, code: string): Promise<OtpVerifyResult>;

  // ── Biometrics (FR-AUTH-04; ADR-0012) ─────────────────────────────────
  // One primitive for every use: a strong-biometric-bound P-256 key signs bytes the core chose,
  // and the core verifies the signature. Unlock signs a single-use challenge; slice 6 will sign
  // transfers (a different, versioned message, fixtures/biometric.json).
  getBiometricStatus(): Promise<BiometricStatus>;
  /**
   * Checks the PIN first (counted like verifyPin), then creates the key and confirms it with
   * one scan. Anything short of ENABLED leaves biometrics off.
   */
  enableBiometrics(pin: string, prompt: BiometricPromptText): Promise<BiometricEnableResult>;
  /** Deletes the key and its public key. resetAuth does the same. */
  disableBiometrics(): Promise<void>;
  /** NOT_FOUND if biometric unlock isn't enabled. Never changes the PIN counter. */
  unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlockResult>;

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

