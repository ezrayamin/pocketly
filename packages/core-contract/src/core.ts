import type {
  AmountCheck,
  AuthState,
  BiometricEnableResult,
  BiometricPromptText,
  BiometricStatus,
  BiometricUnlockResult,
  ContactSearch,
  DatasetConfig,
  MinorUnits,
  AppNotification,
  MoneyParseResult,
  NetworkSimulation,
  NotificationList,
  OtpSendResult,
  OtpVerifyResult,
  PhoneCheck,
  PinCheck,
  PriceStreamOptions,
  PriceTick,
  QrCode,
  QrPaymentDraft,
  QrPaymentReview,
  SpendingSummary,
  Subscription,
  TopUpMethod,
  TopUpReview,
  Transaction,
  TransactionPage,
  TransferAuth,
  TransferDraft,
  TransferResult,
  TransferReview,
  TxFilter,
  UnlockResult,
  Wallet,
} from './types';

export type CoreImpl = 'js' | 'kmp';

/**
 * The business core. The UI talks to this and nothing else.
 *
 * Two implementations exist (`core-js`, `core-kmp`) and one is picked at bundle
 * time (`CORE_IMPL`). Both must pass `runContractSuite` (BM-PAR-01). Benchmark-only entry
 * points are not here: they are `BenchCore` (bench.ts), in perf builds only.
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

  // ── CPU-heavy work (BM-03) ────────────────────────────────────────────
  /**
   * Over the local replica. `month` is `YYYY-MM` in the core's time zone; byDay uses local
   * dates; balanceCheck compares the replica's ledger with the server balance last received.
   */
  computeSpendingSummary(month: string): Promise<SpendingSummary>;

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
  // and the core verifies the signature. Unlock signs a single-use challenge; confirmTransfer
  // signs the transfer (a different, versioned message, fixtures/biometric.json).
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

  // ── P2P transfer (F5, FR-TRF-01..11; ADR-0014) ───────────────────────
  // One flow at a time: searchContacts → startTransfer → checkTransferAmount (per keystroke) →
  // reviewTransfer (creates the attempt and its idempotency key) → confirmTransfer → (if
  // PENDING) getTransferStatus. Network failures reject with NETWORK_* / SERVER_ERROR; the Send
  // flow treats them as "can't send right now" (FR-TRF-11).
  /**
   * FR-TRF-01. `recent` (empty query only) comes from the replica; `contacts` from the server.
   * This install's verified phone is never listed; typing it gives phoneLookup SELF.
   */
  searchContacts(query: string): Promise<ContactSearch>;
  /**
   * Picks the recipient and reads the wallet fresh from the server (never cached data: FR-TRF-11).
   * RECIPIENT_NOT_FOUND for an unknown user; INVALID_ARGUMENT for this install's own phone.
   * Replaces any draft; attempts already sent keep going.
   */
  startTransfer(recipientId: string): Promise<TransferDraft>;
  /**
   * FR-TRF-02, synchronous, against the current draft: a transfer's (startTransfer) or a QR
   * payment's (startQrPayment), whichever was started last. NOT_FOUND without one.
   */
  checkTransferAmount(text: string): AmountCheck;
  /**
   * FR-TRF-03/05: creates the attempt and its idempotency key (UUID v4). The amount must pass
   * checkTransferAmount's limits (else INVALID_ARGUMENT, INSUFFICIENT_FUNDS or
   * DAILY_LIMIT_EXCEEDED); the note is trimmed, at most TRANSFER_NOTE_MAX_LENGTH, one line.
   * NOT_FOUND without a draft. Reviewing again makes a new attempt (nothing was sent).
   */
  reviewTransfer(amount: MinorUnits, note?: string): Promise<TransferReview>;
  /**
   * FR-TRF-04..09, FR-TOP-03, FR-QR-04. Takes any kind of attempt: a transfer's (reviewTransfer),
   * a top-up's (reviewTopUp) or a QR payment's (reviewQrPayment). A DRAFT transfer or QR payment
   * needs `auth`: biometrics sign its kind's message (ADR-0012, ADR-0016 §2), or the PIN is
   * checked like verifyPin. A DRAFT top-up takes no `auth` and answers `auth: NOT_REQUIRED`
   * (ADR-0015 §2). Then it's sent with the attempt's key and
   * waits up to writeTimeoutMs. A FAILED attempt whose `retryable` is true is sent again with the
   * same key and no new `auth`. A call while one is running gets that call's result (double
   * tap). SUCCESS / PENDING / non-retryable FAILED attempts just return their result.
   * NOT_FOUND for an unknown id; INVALID_ARGUMENT for a DRAFT transfer or QR payment without
   * `auth`, or a top-up with one.
   */
  confirmTransfer(id: string, auth?: TransferAuth): Promise<TransferResult>;
  /**
   * FR-TRF-09, FR-TOP-03: asks the server about a PENDING attempt of either kind (also one
   * restored from the replica after a restart, NFR-REL-03). Other states return their result.
   * Rejects with the network error when the server can't be reached (the attempt stays PENDING).
   */
  getTransferStatus(id: string): Promise<TransferResult>;
  /** FR-TRF-10, developer menu: the fake server's daily limit, 0..MAX_AMOUNT_MINOR; resetData restores the default. */
  setDailyLimit(minor: MinorUnits): Promise<void>;

  // ── Top-up (F6, FR-TOP-01..03; ADR-0015) ──────────────────────────────
  // checkTopUpAmount (per keystroke) → reviewTopUp (creates the attempt and its key) →
  // confirmTransfer(id) with no auth → (if PENDING) getTransferStatus(id). SUCCESS adds the
  // amount to the balance; PENDING doesn't until the server settles it (ADR-0015 §3).
  /**
   * FR-TOP-01, synchronous, needs no draft and no server: the keypad rules of
   * checkTransferAmount, then BELOW_MINIMUM (< TOP_UP_MIN_MINOR) and ABOVE_MAXIMUM
   * (> TOP_UP_MAX_MINOR). `remainingBalance` is never set.
   */
  checkTopUpAmount(text: string): AmountCheck;
  /**
   * FR-TOP-01/02: reads the wallet fresh from the server (never cached data, so offline rejects
   * with NETWORK_*), then creates the attempt and its idempotency key (UUID v4). The amount must
   * pass checkTopUpAmount's limits, else INVALID_ARGUMENT. Reviewing again makes a new attempt
   * (nothing was sent); a transfer's draft is left alone.
   */
  reviewTopUp(amount: MinorUnits, method: TopUpMethod): Promise<TopUpReview>;

  // ── QR Pay & My QR (F7, F8, FR-QR-01..05; ADR-0016) ─────────────────
  // parseQr (the scanned text) → MERCHANT: startQrPayment → (static code) checkTransferAmount per
  // keystroke → reviewQrPayment → confirmTransfer(id, auth) → (if PENDING) getTransferStatus.
  // USER: startTransfer(userId) and the Send flow.
  /**
   * FR-QR-02, synchronous, no server, never throws: strict parsing of ADR-0016 §3's payload
   * (fixtures/qr.json). The code carries IDs only.
   */
  parseQr(text: string): QrCode;
  /**
   * The merchant (and, for a dynamic code, its payment request) and a fresh wallet from the
   * server; becomes the current draft (replacing a transfer's). INVALID_QR for an unknown merchant
   * or a request of another merchant, QR_EXPIRED, QR_ALREADY_PAID, NETWORK_* offline.
   */
  startQrPayment(merchantId: string, requestId?: string): Promise<QrPaymentDraft>;
  /**
   * Creates the attempt and its idempotency key (UUID v4). The amount must pass
   * checkTransferAmount's limits (INVALID_ARGUMENT, INSUFFICIENT_FUNDS, DAILY_LIMIT_EXCEEDED) and,
   * for a dynamic code, equal the request's (INVALID_ARGUMENT). NOT_FOUND without a QR draft.
   */
  reviewQrPayment(amount: MinorUnits): Promise<QrPaymentReview>;
  /**
   * F8: this account's code, `pocketly://user/v1?u=<userId>`. The user ID comes from the server
   * once and is kept with the verified phone (ADR-0016 §6). NOT_FOUND before a phone is verified;
   * NETWORK_* the first time if offline.
   */
  getMyQr(): Promise<string>;

  // ── Notifications (F9, FR-NOTIF-01..03; ADR-0017) ────────────────────
  // The core reads the server's event log after each "new events" signal, on start and on each
  // first-page refresh (getTransactions), applies each event once (history and balance update, and a
  // notification), and keeps the newest NOTIFICATIONS_KEPT in the replica. It does this whether or
  // not anything is subscribed. logout and resetData clear them.
  /**
   * FR-NOTIF-01/02: `onNew` gets the notifications each catch-up added, newest first, while
   * subscribed. Unsubscribing stops delivery, not the catching up.
   */
  subscribeNotifications(onNew: (notifications: AppNotification[]) => void): Subscription;
  /** FR-NOTIF-03: from the replica, never the server. */
  getNotifications(): Promise<NotificationList>;
  /** FR-NOTIF-03: every notification read; the badge clears. */
  markNotificationsRead(): Promise<void>;

  // ── Money (NFR-MONEY-02; BM-06 times formatMoney) ────────────────────
  formatMoney(minor: MinorUnits): string;
  parseMoney(input: string): MoneyParseResult;

  // ── Streams (BM-05, NFR-ARCH-04) ──────────────────────────────────────
  subscribePrices(
    symbols: string[],
    onTicks: (ticks: PriceTick[]) => void,
    options?: PriceStreamOptions,
  ): Subscription;
}

