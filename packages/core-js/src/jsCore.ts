import {
  CoreError,
  DEFAULT_DATASET,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PRICE_INTERVAL_MS,
  MAX_PAGE_SIZE,
  OTP_LENGTH,
  toCoreError,
} from '@pocketly/core-contract';
import type {
  AuthState,
  BiometricEnableResult,
  BiometricPromptText,
  BiometricStatus,
  BiometricUnlockResult,
  Core,
  DatasetConfig,
  ErrorCode,
  IngestResult,
  MoneyParseResult,
  NetworkSimulation,
  OtpSendResult,
  OtpVerifyResult,
  PhoneCheck,
  PinCheck,
  PriceStreamOptions,
  PriceTick,
  SpendingSummary,
  StaleInfo,
  Subscription,
  Transaction,
  TransactionPage,
  TxFilter,
  UnlockResult,
  Wallet,
} from '@pocketly/core-contract';
import { CacheStore } from './data/cacheStore';
import type { SqlDriver } from './data/db/sqlDriver';
import { FakeWalletApi } from './data/fake/fakeWalletApi';
import { ServerStore } from './data/fake/serverStore';
import { TimeoutWalletApi } from './data/timeoutWalletApi';
import { parseAndValidate } from './data/transactionIngestor';
import { UserTimeZone } from './data/timeZone';
import { formatMoney, parseMoney } from './domain/money';
import { BiometricAuth } from './security/biometricAuth';
import type { BiometricSigner } from './security/biometricSigner';
import { PinAuth } from './security/pinAuth';
import { checkPhone, isValidE164 } from './security/phonePolicy';
import type { PinCrypto } from './security/pinCrypto';
import { checkPin } from './security/pinPolicy';
import type { SecureStore } from './security/secureStore';
import { computeSpendingSummary } from './domain/spendingSummary';
import { LedgerSync } from './sync/ledgerSync';
import { PriceFeed } from './sync/priceFeed';

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** Failures where the local replica stands in for the server (ADR-0009). */
const STALEABLE: ReadonlySet<ErrorCode> = new Set(['NETWORK_UNAVAILABLE', 'NETWORK_TIMEOUT', 'SERVER_ERROR']);

export interface JsCoreOptions {
  /** The fake backend's database (pocketly-server.db). */
  server: SqlDriver;
  /** The app's local replica (pocketly-cache.db). */
  cache: SqlDriver;
  /** Seeds the server only if its database is empty. Default: DEFAULT_DATASET (frozen clock). */
  dataset?: DatasetConfig;
  /** Secrets (ADR-0010): Keystore / Keychain in the app. */
  secure: SecureStore;
  crypto: PinCrypto;
  /** ADR-0012: the strong-biometric-bound signing key. */
  biometrics: BiometricSigner;
  /** Device clock for PIN lockouts. Tests only. */
  clock?: () => number;
  /** PBKDF2 work factor for new PIN records. Tests only; default PIN_PBKDF2_ITERATIONS. */
  pinIterations?: number;
}

/** Composition root for the TypeScript core. Counterpart of shared/.../bridge/PocketlyCore.kt. */
export class JsCore implements Core {
  readonly impl = 'js' as const;

  private zone = new UserTimeZone('UTC');
  private readonly backend: FakeWalletApi;
  /** NFR-REL-01: the core only talks to the backend through a timeout. */
  private readonly api: TimeoutWalletApi;
  private readonly cache: CacheStore;
  private readonly ledgerSync: LedgerSync;
  /** Databases open lazily; every data call awaits this first. */
  private readonly ready: Promise<void>;
  private computeMs = 0;
  private storageMs = 0;
  /** BM-04b: a payload held in the core, as a network response would be. Survives resetData. */
  private stagedPayload: string | undefined;
  private readonly pin: PinAuth;
  private readonly biometric: BiometricAuth;

  constructor(options: JsCoreOptions) {
    const backend = new FakeWalletApi(new ServerStore(options.server), () => this.zone, options.clock ?? Date.now);
    const cache = new CacheStore(options.cache);
    this.backend = backend;
    this.api = new TimeoutWalletApi(backend, () => backend.network.get().readTimeoutMs!);
    this.cache = cache;
    this.ledgerSync = new LedgerSync(this.api, cache);
    this.ready = (async () => {
      await backend.open(options.dataset ?? DEFAULT_DATASET);
      await cache.init();
    })();
    this.pin = new PinAuth({
      store: options.secure,
      crypto: options.crypto,
      marker: {
        get: async () => {
          await this.ready;
          return cache.installId();
        },
        set: async (id) => {
          await this.ready;
          await cache.setInstallId(id);
        },
      },
      clock: options.clock,
      iterations: options.pinIterations,
    });
    this.biometric = new BiometricAuth(this.pin, options.biometrics, options.crypto, options.clock);
  }

  async resetData(config: DatasetConfig = DEFAULT_DATASET): Promise<void> {
    await this.ready;
    await this.backend.reset(config);
    await this.cache.clear();
    try {
      await this.ledgerSync.sync();
      await this.fetchWallet();
    } catch (e) {
      if (!STALEABLE.has(toCoreError(e).code)) throw e; // offline reset: replica stays empty
    }
  }

  async getWallet(): Promise<Wallet> {
    await this.ready;
    try {
      return await this.fetchWallet();
    } catch (e) {
      const error = toCoreError(e);
      const cached = STALEABLE.has(error.code) ? await this.cache.getWallet() : undefined;
      if (cached === undefined) throw error;
      return { ...cached.wallet, stale: { reason: error.code, cachedAt: cached.cachedAt } };
    }
  }

  /** From the server into the replica, unless the replica was cleared meanwhile (logout). */
  private async fetchWallet(): Promise<Wallet> {
    const generation = this.cache.generation;
    const wallet = await this.api.getWallet();
    if (this.cache.generation === generation) await this.cache.upsertWallet(wallet, Date.now());
    return wallet;
  }

  async getTransactions(
    cursor?: string,
    limit: number = DEFAULT_PAGE_SIZE,
    filter?: TxFilter,
  ): Promise<TransactionPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new CoreError('INVALID_ARGUMENT', `limit must be 1..${MAX_PAGE_SIZE}, got ${limit}`);
    }
    await this.ready;
    let stale: StaleInfo | undefined;
    if (cursor === undefined) {
      try {
        await this.ledgerSync.sync(); // the first page is a refresh
      } catch (e) {
        const error = toCoreError(e);
        const cachedAt = STALEABLE.has(error.code) ? await this.cache.lastSyncedAt() : undefined;
        if (cachedAt === undefined) throw error;
        stale = { reason: error.code, cachedAt };
      }
    }
    const page = await this.cache.page(cursor, limit, filter);
    return stale ? { ...page, stale } : page;
  }

  async getTransaction(id: string): Promise<Transaction> {
    await this.ready;
    return (await this.cache.get(id)) ?? this.api.getTransaction(id);
  }

  async computeSpendingSummary(month: string): Promise<SpendingSummary> {
    await this.ready;
    const start = now();
    const transactions = await this.cache.all();
    const cachedWallet = await this.cache.getWallet();
    this.storageMs = now() - start;
    const walletBalance = cachedWallet?.wallet.balance ?? 0;
    return this.timed(() => computeSpendingSummary(month, this.zone.month(month), transactions, walletBalance));
  }

  async stageIngestPayload(json: string): Promise<void> {
    this.stagedPayload = json;
  }

  ingestStaged(): Promise<IngestResult> {
    if (this.stagedPayload === undefined) {
      return Promise.reject(new CoreError('INVALID_ARGUMENT', 'no ingest payload staged'));
    }
    return this.ingestTransactions(this.stagedPayload);
  }

  async ingestTransactions(json: string): Promise<IngestResult> {
    await this.ready;
    const parsed = this.timed(() => parseAndValidate(json));
    const start = now();
    const inserted = await this.cache.insertIfAbsentMany(parsed.valid);
    this.storageMs = now() - start;
    return {
      accepted: inserted,
      rejected: parsed.rejected,
      duplicates: parsed.valid.length - inserted,
      errors: parsed.errors,
    };
  }

  setNetworkSimulation(simulation: NetworkSimulation): void {
    this.backend.network.set(simulation);
  }

  getNetworkSimulation(): NetworkSimulation {
    return this.backend.network.get();
  }

  async simulateIncomingTransfer(): Promise<Transaction> {
    await this.ready;
    return this.backend.simulateIncomingTransfer();
  }

  setTimeZone(zoneId: string): void {
    if (zoneId !== this.zone.zoneId) {
      this.zone = new UserTimeZone(zoneId);
    }
  }

  checkPin(pin: string): PinCheck {
    return checkPin(pin);
  }

  setPin(pin: string): Promise<void> {
    return this.pin.setPin(pin);
  }

  verifyPin(pin: string): Promise<UnlockResult> {
    return this.pin.verifyPin(pin);
  }

  getAuthState(): Promise<AuthState> {
    return this.pin.getAuthState();
  }

  resetAuth(): Promise<void> {
    return this.biometric.reset();
  }

  async logout(): Promise<void> {
    // The replica first: if the secrets then fail to go, nothing of the history is left behind.
    await this.ready;
    await this.cache.clear();
    await this.biometric.reset();
  }

  checkPhone(nationalNumber: string): PhoneCheck {
    return checkPhone(nationalNumber);
  }

  async requestOtp(phone: string): Promise<OtpSendResult> {
    if (!isValidE164(phone)) throw new CoreError('INVALID_ARGUMENT', 'not a valid +62 mobile number');
    await this.ready;
    return this.api.requestOtp(phone);
  }

  async verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
    if (!isValidE164(phone)) throw new CoreError('INVALID_ARGUMENT', 'not a valid +62 mobile number');
    if (!new RegExp(`^[0-9]{${OTP_LENGTH}}$`).test(code)) throw new CoreError('INVALID_ARGUMENT', `the code has ${OTP_LENGTH} digits`);
    await this.ready;
    const { sessionToken, ...result } = await this.api.verifyOtp(phone, code);
    if (result.outcome === 'VERIFIED' && sessionToken !== undefined) await this.pin.rememberVerifiedPhone(phone, sessionToken);
    return result;
  }

  getBiometricStatus(): Promise<BiometricStatus> {
    return this.biometric.status();
  }

  enableBiometrics(pin: string, prompt: BiometricPromptText): Promise<BiometricEnableResult> {
    return this.biometric.enable(pin, prompt);
  }

  disableBiometrics(): Promise<void> {
    return this.biometric.disable();
  }

  unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlockResult> {
    return this.biometric.unlock(prompt);
  }

  getAutoLockTimeout(): Promise<number> {
    return this.pin.getAutoLockTimeout();
  }

  setAutoLockTimeout(ms: number): Promise<void> {
    return this.pin.setAutoLockTimeout(ms);
  }

  echo(value: number): number {
    return value;
  }

  formatMoney(minor: number): string {
    return formatMoney(minor);
  }

  formatMoneyBatch(minors: number[]): string[] {
    this.storageMs = 0;
    return this.timed(() => minors.map(formatMoney));
  }

  parseMoney(input: string): MoneyParseResult {
    return parseMoney(input);
  }

  subscribePrices(
    symbols: string[],
    onTicks: (ticks: PriceTick[]) => void,
    options?: PriceStreamOptions,
  ): Subscription {
    const feed = new PriceFeed(symbols, options?.seed ?? 1);
    const handle = setInterval(() => onTicks(feed.step()), options?.intervalMs ?? DEFAULT_PRICE_INTERVAL_MS);
    return { unsubscribe: () => clearInterval(handle) };
  }

  lastComputeMs(): number {
    return this.computeMs;
  }

  lastStorageMs(): number {
    return this.storageMs;
  }

  private timed<T>(work: () => T): T {
    const start = now();
    try {
      return work();
    } finally {
      this.computeMs = now() - start;
    }
  }
}

export function createJsCore(options: JsCoreOptions): JsCore {
  return new JsCore(options);
}
