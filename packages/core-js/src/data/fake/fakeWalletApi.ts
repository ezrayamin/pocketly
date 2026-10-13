import { CoreError } from '@pocketly/core-contract';
import type { DatasetConfig, OtpSendResult, Transaction, Wallet } from '@pocketly/core-contract';
import { localEpochDay, localMidnight } from '../../domain/zonedCalendar';
import { validateTransaction } from '../transactionDtoValidator';
import { DAILY_LIMIT, WALLET_ID, generateTransactions, simulatedIncomingTransfer } from '../seedData';
import type { UserTimeZone } from '../timeZone';
import type { ChangesPage, FakeBackendControls, ServerOtpVerify, WalletApi } from '../walletApi';
import { NetworkSimulator } from './networkSimulator';
import { OtpServer } from './otpServer';
import type { ServerStore } from './serverStore';

/** Server-side page size cap for getChanges (sync). Same as Kotlin. */
export const MAX_CHANGES_PAGE = 500;

const META_SEEDED = 'seeded';
const META_FROZEN_NOW = 'frozenNowMillis';
const META_SIMULATED_INCOMING = 'simulatedIncoming';
const TOKEN = /^(-?\d+):(.*)$/;

/**
 * In-process fake backend (requirements §4.2) on its own database (ADR-0009). Its clock is
 * frozen at `DatasetConfig.nowMillis` when given (tests, benchmarks) and is the device clock
 * otherwise (the app). State survives restarts (FR-FAKE-07). Mirrors shared/.../data/fake/FakeWalletApi.kt.
 */
export class FakeWalletApi implements WalletApi, FakeBackendControls {
  readonly network = new NetworkSimulator();
  private frozenNow: number | undefined;
  private simulatedIncoming = 0;

  private readonly otp: OtpServer;

  constructor(
    private readonly store: ServerStore,
    private readonly timeZone: () => UserTimeZone,
    /** The OTP side's clock (ADR-0013): the device's, not the dataset's frozen one. */
    otpClock: () => number = Date.now,
  ) {
    this.otp = new OtpServer(otpClock);
  }

  async requestOtp(phone: string): Promise<OtpSendResult> {
    await this.network.beforeCall();
    return this.otp.send(phone);
  }

  async verifyOtp(phone: string, code: string): Promise<ServerOtpVerify> {
    await this.network.beforeCall();
    return this.otp.verify(phone, code);
  }

  now(): number {
    return this.frozenNow ?? Date.now();
  }

  /** Opens the database; seeds it with `config` only if it's empty (the app keeps its data). */
  async open(config: DatasetConfig): Promise<void> {
    await this.store.init();
    if ((await this.store.getMeta(META_SEEDED)) === undefined) {
      await this.reset(config);
      return;
    }
    const frozen = await this.store.getMeta(META_FROZEN_NOW);
    this.frozenNow = frozen ? Number(frozen) : undefined;
    this.simulatedIncoming = Number((await this.store.getMeta(META_SIMULATED_INCOMING)) ?? 0);
  }

  async reset(config: DatasetConfig): Promise<void> {
    if (!Number.isSafeInteger(config.transactionCount) || config.transactionCount < 1) {
      throw new CoreError('INVALID_ARGUMENT', 'transactionCount must be >= 1');
    }
    if (config.nowMillis !== undefined && !Number.isSafeInteger(config.nowMillis)) {
      throw new CoreError('INVALID_ARGUMENT', 'nowMillis must be a safe integer');
    }
    const extra = (config.extraTransactions ?? []).map((raw, index) => {
      const result = validateTransaction(raw);
      if (!result.ok) {
        throw new CoreError('INVALID_ARGUMENT', `extraTransactions[${index}]: ${result.reason}`);
      }
      return result.value;
    });
    this.frozenNow = config.nowMillis;
    this.simulatedIncoming = 0;
    await this.store.replaceAll([...generateTransactions(config, this.now()), ...extra], {
      [META_SEEDED]: '1',
      [META_FROZEN_NOW]: config.nowMillis === undefined ? '' : String(config.nowMillis),
      [META_SIMULATED_INCOMING]: '0',
    });
  }

  async simulateIncomingTransfer(): Promise<Transaction> {
    const tx = simulatedIncomingTransfer(this.simulatedIncoming + 1, this.now());
    await this.store.insert(tx);
    this.simulatedIncoming += 1;
    await this.store.setMeta(META_SIMULATED_INCOMING, String(this.simulatedIncoming));
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
      balance: await this.store.balance(),
      dailyLimit: DAILY_LIMIT,
      usedToday: await this.store.usedSince(todayStart),
      updatedAt: now,
    };
  }

  async getChanges(afterToken: string | undefined, limit: number): Promise<ChangesPage> {
    await this.network.beforeCall();
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANGES_PAGE) {
      throw new CoreError('INVALID_ARGUMENT', `limit must be 1..${MAX_CHANGES_PAGE}`);
    }
    let afterUpdatedAt = -1;
    let afterId = '';
    if (afterToken !== undefined) {
      const m = TOKEN.exec(afterToken);
      if (!m) throw new CoreError('INVALID_ARGUMENT', 'Malformed sync token');
      afterUpdatedAt = Number(m[1]);
      afterId = m[2];
    }
    const rows = await this.store.changesSince(afterUpdatedAt, afterId, limit + 1);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items,
      nextToken: last ? `${last.updatedAt}:${last.id}` : afterToken,
      hasMore: rows.length > limit,
    };
  }

  async getTransaction(id: string): Promise<Transaction> {
    await this.network.beforeCall();
    const tx = await this.store.get(id);
    if (tx === undefined) throw new CoreError('NOT_FOUND', `No transaction ${id}`);
    return tx;
  }
}
