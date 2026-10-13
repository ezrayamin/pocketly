import { NitroModules } from 'react-native-nitro-modules';
import {
  DEFAULT_DATASET,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PRICE_INTERVAL_MS,
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
  Subscription,
  Transaction,
  TransactionPage,
  TxFilter,
  UnlockResult,
  Wallet,
} from '@pocketly/core-contract';
import type { PocketlyCore } from './specs/PocketlyCore.nitro';

export type { PocketlyCore, PriceSubscription } from './specs/PocketlyCore.nitro';

/**
 * Adapts the Nitro hybrid object to the `Core` contract. Deliberately thin: argument
 * defaults + error decoding only. Everything else happens in Kotlin.
 */
export class KmpCore implements Core {
  readonly impl = 'kmp' as const;

  constructor(private readonly native: PocketlyCore) {}

  resetData(config: DatasetConfig = DEFAULT_DATASET): Promise<void> {
    const { extraTransactions = [], ...seed } = config;
    return this.native.resetData(seed, extraTransactions).catch(rethrow);
  }

  getWallet(): Promise<Wallet> {
    return this.native.getWallet().catch(rethrow);
  }

  getTransactions(cursor?: string, limit: number = DEFAULT_PAGE_SIZE, filter?: TxFilter): Promise<TransactionPage> {
    return this.native.getTransactions(cursor, limit, filter).catch(rethrow);
  }

  getTransaction(id: string): Promise<Transaction> {
    return this.native.getTransaction(id).catch(rethrow);
  }

  setNetworkSimulation(simulation: NetworkSimulation): void {
    try {
      this.native.setNetworkSimulation(simulation);
    } catch (e) {
      throw toCoreError(e);
    }
  }

  getNetworkSimulation(): NetworkSimulation {
    return this.native.getNetworkSimulation();
  }

  simulateIncomingTransfer(): Promise<Transaction> {
    return this.native.simulateIncomingTransfer().catch(rethrow);
  }

  setTimeZone(zoneId: string): void {
    try {
      this.native.setTimeZone(zoneId);
    } catch (e) {
      throw toCoreError(e);
    }
  }

  computeSpendingSummary(month: string): Promise<SpendingSummary> {
    return this.native.computeSpendingSummary(month).catch(rethrow);
  }

  ingestTransactions(json: string): Promise<IngestResult> {
    return this.native.ingestTransactions(json).catch(rethrow);
  }

  stageIngestPayload(json: string): Promise<void> {
    return this.native.stageIngestPayload(json).catch(rethrow);
  }

  ingestStaged(): Promise<IngestResult> {
    return this.native.ingestStaged().catch(rethrow);
  }

  checkPin(pin: string): PinCheck {
    const check = this.native.checkPin(pin);
    return check.ok ? { ok: true } : { ok: false, reason: check.reason };
  }

  setPin(pin: string): Promise<void> {
    return this.native.setPin(pin).catch(rethrow);
  }

  async verifyPin(pin: string): Promise<UnlockResult> {
    const r = await this.native.verifyPin(pin).catch(rethrow);
    return r.lockedUntil === undefined ? { outcome: r.outcome, attemptsLeft: r.attemptsLeft } : r;
  }

  async getAuthState(): Promise<AuthState> {
    const s = await this.native.getAuthState().catch(rethrow);
    return withoutUndefined({ phone: s.phone, pinSet: s.pinSet, failedAttempts: s.failedAttempts, lockedUntil: s.lockedUntil });
  }

  resetAuth(): Promise<void> {
    return this.native.resetAuth().catch(rethrow);
  }

  logout(): Promise<void> {
    return this.native.logout().catch(rethrow);
  }

  getAutoLockTimeout(): Promise<number> {
    return this.native.getAutoLockTimeout().catch(rethrow);
  }

  setAutoLockTimeout(ms: number): Promise<void> {
    return this.native.setAutoLockTimeout(ms).catch(rethrow);
  }

  checkPhone(nationalNumber: string): PhoneCheck {
    const c = this.native.checkPhone(nationalNumber);
    return withoutUndefined({ ok: c.ok, e164: c.e164, reason: c.reason });
  }

  requestOtp(phone: string): Promise<OtpSendResult> {
    return this.native.requestOtp(phone).catch(rethrow);
  }

  async verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
    const r = await this.native.verifyOtp(phone, code).catch(rethrow);
    return withoutUndefined({ outcome: r.outcome, attemptsLeft: r.attemptsLeft, retryAt: r.retryAt });
  }

  async getBiometricStatus(): Promise<BiometricStatus> {
    const s = await this.native.getBiometricStatus().catch(rethrow);
    return withoutUndefined({ available: s.available, reason: s.reason, kind: s.kind, enabled: s.enabled });
  }

  async enableBiometrics(pin: string, prompt: BiometricPromptText): Promise<BiometricEnableResult> {
    const r = await this.native.enableBiometrics(pin, prompt).catch(rethrow);
    return withoutUndefined({ outcome: r.outcome, attemptsLeft: r.attemptsLeft, lockedUntil: r.lockedUntil });
  }

  disableBiometrics(): Promise<void> {
    return this.native.disableBiometrics().catch(rethrow);
  }

  unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlockResult> {
    return this.native.unlockWithBiometrics(prompt).catch(rethrow);
  }

  // Straight through: it can't throw, and BM-06 times exactly this path.
  echo(value: number): number {
    return this.native.echo(value);
  }

  formatMoney(minor: number): string {
    try {
      return this.native.formatMoney(minor);
    } catch (e) {
      throw toCoreError(e);
    }
  }

  formatMoneyBatch(minors: number[]): string[] {
    try {
      return this.native.formatMoneyBatch(minors);
    } catch (e) {
      throw toCoreError(e);
    }
  }

  parseMoney(input: string): MoneyParseResult {
    return this.native.parseMoney(input);
  }

  subscribePrices(
    symbols: string[],
    onTicks: (ticks: PriceTick[]) => void,
    options?: PriceStreamOptions,
  ): Subscription {
    const sub = this.native.subscribePrices(
      symbols,
      options?.intervalMs ?? DEFAULT_PRICE_INTERVAL_MS,
      options?.seed ?? 1,
      onTicks,
    );
    return { unsubscribe: () => sub.unsubscribe() };
  }

  lastComputeMs(): number {
    return this.native.lastComputeMs();
  }

  lastStorageMs(): number {
    return this.native.lastStorageMs();
  }
}

/** Optional struct fields arrive as explicit `undefined`; the contract omits them (as jsCore does). */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function rethrow(e: unknown): never {
  throw toCoreError(e);
}

export function createKmpCore(): Core {
  return new KmpCore(NitroModules.createHybridObject<PocketlyCore>('PocketlyCore'));
}

/** Entry point used by `apps/mobile/src/core.ts` when CORE_IMPL=kmp. */
export function createCore(): Core {
  return createKmpCore();
}
