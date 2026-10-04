import { CoreError, MAX_PAGE_SIZE } from '@pocketly/core-contract';
import type { DatasetConfig, Transaction, TransactionPage, TxFilter, Wallet } from '@pocketly/core-contract';
import { localEpochDay, localMidnight } from '../domain/zonedCalendar';
import { NetworkSimulator } from './fake/networkSimulator';
import { DAILY_LIMIT, WALLET_ID, generateTransactions, simulatedIncomingTransfer } from './seedData';
import type { UserTimeZone } from './timeZone';
import type { TransactionStore } from './transactionStore';
import type { FakeBackendControls, WalletApi } from './walletApi';

/**
 * In-process fake backend (requirements §4.2). Serves straight from the store.
 * Its clock is frozen at `DatasetConfig.nowMillis` when given (tests, benchmarks) and is
 * the device clock otherwise (the app). Latency/failure simulation (FR-FAKE-04) arrives
 * with the developer menu. Mirrors shared/.../data/fake/FakeWalletApi.kt.
 */
export class FakeWalletApi implements WalletApi, FakeBackendControls {
  readonly network = new NetworkSimulator();
  private frozenNow: number | undefined;
  private simulatedIncoming = 0;

  constructor(
    private readonly store: TransactionStore,
    private readonly timeZone: () => UserTimeZone,
  ) {}

  now(): number {
    return this.frozenNow ?? Date.now();
  }

  reset(config: DatasetConfig): void {
    if (!Number.isSafeInteger(config.transactionCount) || config.transactionCount < 1) {
      throw new CoreError('INVALID_ARGUMENT', 'transactionCount must be >= 1');
    }
    if (config.nowMillis !== undefined && !Number.isSafeInteger(config.nowMillis)) {
      throw new CoreError('INVALID_ARGUMENT', 'nowMillis must be a safe integer');
    }
    this.frozenNow = config.nowMillis;
    this.simulatedIncoming = 0;
    this.store.replaceAll(generateTransactions(config, this.now()));
  }

  simulateIncomingTransfer(): Transaction {
    const tx = simulatedIncomingTransfer(++this.simulatedIncoming, this.now());
    this.store.insertAll([tx]);
    return tx;
  }

  async getWallet(): Promise<Wallet> {
    await this.network.beforeCall();
    const now = this.now();
    const offsetAt = this.timeZone().offsetAt;
    // FR-TRF-10: the daily limit resets at local midnight in the user's zone (ADR-0006).
    const todayStart = localMidnight(localEpochDay(now, offsetAt), offsetAt);
    return {
      id: WALLET_ID,
      balance: this.store.balance(),
      dailyLimit: DAILY_LIMIT,
      usedToday: this.store.usedSince(todayStart),
      updatedAt: now,
    };
  }

  async getTransactions(cursor: string | undefined, limit: number, filter?: TxFilter): Promise<TransactionPage> {
    await this.network.beforeCall();
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new CoreError('INVALID_ARGUMENT', `limit must be 1..${MAX_PAGE_SIZE}, got ${limit}`);
    }
    return this.store.page(cursor, limit, filter);
  }

  async getTransaction(id: string): Promise<Transaction> {
    await this.network.beforeCall();
    const tx = this.store.get(id);
    if (tx === undefined) {
      throw new CoreError('NOT_FOUND', `No transaction ${id}`);
    }
    return tx;
  }
}
