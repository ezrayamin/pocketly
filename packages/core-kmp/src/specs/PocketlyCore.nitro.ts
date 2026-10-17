import type { HybridObject } from 'react-native-nitro-modules';
// NFR-ARCH-05: struct/enum types are NOT redeclared here. Nitrogen resolves them from
// the contract package, so core-contract/src/types.ts stays the single source of truth.
import type {
  AuthState,
  BiometricEnableResult,
  BiometricPromptText,
  BiometricStatus,
  BiometricUnlockResult,
  DatasetSeed,
  MoneyParseResult,
  NetworkSimulation,
  OtpSendResult,
  OtpVerifyResult,
  PhoneCheck,
  PinCheck,
  PriceTick,
  SpendingSummary,
  Transaction,
  TransactionPage,
  TxFilter,
  UnlockResult,
  Wallet,
} from '@pocketly/core-contract';

type Platforms = { ios: 'swift'; android: 'kotlin' };

/** A live price stream. Dropping it (or calling unsubscribe) cancels the Kotlin Flow. */
export interface PriceSubscription extends HybridObject<Platforms> {
  unsubscribe(): void;
}

/**
 * The Kotlin Multiplatform core, as seen from JS. Implemented by
 * `HybridPocketlyCore` (android/…/HybridPocketlyCore.kt, ios/HybridPocketlyCore.swift),
 * which are thin adapters over `shared/…/bridge/PocketlyCore`.
 *
 * `src/index.ts` adapts this to the `Core` contract.
 */
export interface PocketlyCore extends HybridObject<Platforms> {
  resetData(config: DatasetSeed): Promise<void>;
  getWallet(): Promise<Wallet>;
  getTransactions(cursor: string | undefined, limit: number, filter: TxFilter | undefined): Promise<TransactionPage>;
  getTransaction(id: string): Promise<Transaction>;

  setNetworkSimulation(simulation: NetworkSimulation): void;
  getNetworkSimulation(): NetworkSimulation;
  simulateIncomingTransfer(): Promise<Transaction>;

  setTimeZone(zoneId: string): void;

  computeSpendingSummary(month: string): Promise<SpendingSummary>;

  checkPin(pin: string): PinCheck;
  setPin(pin: string): Promise<void>;
  verifyPin(pin: string): Promise<UnlockResult>;
  getAuthState(): Promise<AuthState>;
  resetAuth(): Promise<void>;
  logout(): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  setAutoLockTimeout(ms: number): Promise<void>;
  checkPhone(nationalNumber: string): PhoneCheck;
  requestOtp(phone: string): Promise<OtpSendResult>;
  verifyOtp(phone: string, code: string): Promise<OtpVerifyResult>;
  getBiometricStatus(): Promise<BiometricStatus>;
  enableBiometrics(pin: string, prompt: BiometricPromptText): Promise<BiometricEnableResult>;
  disableBiometrics(): Promise<void>;
  unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlockResult>;

  formatMoney(minor: number): string;
  parseMoney(input: string): MoneyParseResult;

  subscribePrices(
    symbols: string[],
    intervalMs: number,
    seed: number,
    onTicks: (ticks: PriceTick[]) => void,
  ): PriceSubscription;
}
