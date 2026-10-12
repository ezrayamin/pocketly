import type { HybridObject } from 'react-native-nitro-modules';
// NFR-ARCH-05: struct/enum types are NOT redeclared here. Nitrogen resolves them from
// the contract package, so core-contract/src/types.ts stays the single source of truth.
import type {
  AuthState,
  DatasetSeed,
  IngestResult,
  MoneyParseResult,
  NetworkSimulation,
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
  /**
   * `DatasetConfig` arrives split: an optional array of structs inside a struct breaks Swift's
   * `std::vector<Transaction>` conformance (Swift 6.1 C++ interop), which a plain array avoids.
   */
  resetData(config: DatasetSeed, extraTransactions: Transaction[]): Promise<void>;
  getWallet(): Promise<Wallet>;
  getTransactions(cursor: string | undefined, limit: number, filter: TxFilter | undefined): Promise<TransactionPage>;
  getTransaction(id: string): Promise<Transaction>;

  setNetworkSimulation(simulation: NetworkSimulation): void;
  getNetworkSimulation(): NetworkSimulation;
  simulateIncomingTransfer(): Promise<Transaction>;

  setTimeZone(zoneId: string): void;

  computeSpendingSummary(month: string): Promise<SpendingSummary>;
  ingestTransactions(json: string): Promise<IngestResult>;
  stageIngestPayload(json: string): Promise<void>;
  ingestStaged(): Promise<IngestResult>;

  checkPin(pin: string): PinCheck;
  setPin(pin: string): Promise<void>;
  verifyPin(pin: string): Promise<UnlockResult>;
  getAuthState(): Promise<AuthState>;
  resetAuth(): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  setAutoLockTimeout(ms: number): Promise<void>;

  echo(value: number): number;
  formatMoney(minor: number): string;
  formatMoneyBatch(minors: number[]): string[];
  parseMoney(input: string): MoneyParseResult;

  subscribePrices(
    symbols: string[],
    intervalMs: number,
    seed: number,
    onTicks: (ticks: PriceTick[]) => void,
  ): PriceSubscription;

  lastComputeMs(): number;
  lastStorageMs(): number;
}
