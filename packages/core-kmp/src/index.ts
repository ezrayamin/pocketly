import { NitroModules } from 'react-native-nitro-modules';
import {
  DEFAULT_DATASET,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PRICE_INTERVAL_MS,
  toCoreError,
} from '@pocketly/core-contract';
import type {
  Core,
  DatasetConfig,
  IngestResult,
  MoneyParseResult,
  PriceStreamOptions,
  PriceTick,
  SpendingSummary,
  Subscription,
  Transaction,
  TransactionPage,
  TxFilter,
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
    return this.native.resetData(config).catch(rethrow);
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
