import { DEFAULT_DATASET, DEFAULT_PAGE_SIZE, DEFAULT_PRICE_INTERVAL_MS } from '@pocketly/core-contract';
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
import { FakeWalletApi } from './data/fakeWalletApi';
import { ingestTransactions } from './data/transactionIngestor';
import { InMemoryTransactionStore } from './data/transactionStore';
import { UserTimeZone } from './data/timeZone';
import { formatMoney, parseMoney } from './domain/money';
import { computeSpendingSummary } from './domain/spendingSummary';
import { PriceFeed } from './sync/priceFeed';

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

export interface JsCoreOptions {
  dataset?: DatasetConfig;
}

/** Composition root for the TypeScript core. Counterpart of shared/.../bridge/PocketlyCore.kt. */
export class JsCore implements Core {
  readonly impl = 'js' as const;

  private readonly store = new InMemoryTransactionStore();
  private zone = new UserTimeZone('UTC');
  private readonly api = new FakeWalletApi(this.store, () => this.zone);
  private computeMs = 0;

  constructor(options: JsCoreOptions = {}) {
    this.api.reset(options.dataset ?? DEFAULT_DATASET);
  }

  async resetData(config: DatasetConfig = DEFAULT_DATASET): Promise<void> {
    this.api.reset(config);
  }

  getWallet(): Promise<Wallet> {
    return this.api.getWallet();
  }

  getTransactions(cursor?: string, limit: number = DEFAULT_PAGE_SIZE, filter?: TxFilter): Promise<TransactionPage> {
    return this.api.getTransactions(cursor, limit, filter);
  }

  getTransaction(id: string): Promise<Transaction> {
    return this.api.getTransaction(id);
  }

  async computeSpendingSummary(month: string): Promise<SpendingSummary> {
    return this.timed(() =>
      computeSpendingSummary(month, this.zone.month(month), this.store.all(), this.store.balance()),
    );
  }

  async ingestTransactions(json: string): Promise<IngestResult> {
    return this.timed(() => ingestTransactions(json, this.store));
  }

  setTimeZone(zoneId: string): void {
    if (zoneId !== this.zone.zoneId) {
      this.zone = new UserTimeZone(zoneId);
    }
  }

  formatMoney(minor: number): string {
    return formatMoney(minor);
  }

  formatMoneyBatch(minors: number[]): string[] {
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

  private timed<T>(work: () => T): T {
    const start = now();
    try {
      return work();
    } finally {
      this.computeMs = now() - start;
    }
  }
}

export function createJsCore(options?: JsCoreOptions): JsCore {
  return new JsCore(options);
}
