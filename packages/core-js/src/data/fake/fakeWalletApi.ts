import { CoreError, MAX_AMOUNT_MINOR } from '@pocketly/core-contract';
import type { Contact, DatasetConfig, OtpSendResult, Transaction, Wallet } from '@pocketly/core-contract';
import { exceededLimit, isValidTransferAmount, normalizeNote } from '../../domain/transferPolicy';
import { localEpochDay, localMidnight } from '../../domain/zonedCalendar';
import { matchDirectory } from '../contactSearch';
import { validateTransaction } from '../transactionDtoValidator';
import { CONTACTS, DAILY_LIMIT, WALLET_ID, generateTransactions, simulatedIncomingTransfer } from '../seedData';
import type { UserTimeZone } from '../timeZone';
import type { ChangesPage, FakeBackendControls, ServerOtpVerify, TransferRequest, WalletApi } from '../walletApi';
import { NetworkSimulator } from './networkSimulator';
import { OtpServer } from './otpServer';
import type { ServerStore } from './serverStore';


/** A dataset plus extra seed rows: tests and benchmarks only (BenchCore.resetDataWithExtras). */
export type ServerDataset = DatasetConfig & { extraTransactions?: readonly Transaction[] };

/** Server-side page size cap for getChanges (sync). Same as Kotlin. */
export const MAX_CHANGES_PAGE = 500;

const META_SEEDED = 'seeded';
const META_FROZEN_NOW = 'frozenNowMillis';
const META_SIMULATED_INCOMING = 'simulatedIncoming';
const META_DAILY_LIMIT = 'dailyLimit';
const META_TRANSFERS = 'transfers';
/** The phone this account verified by OTP (ADR-0013): no transfers to it. Kept by reset. */
const META_ACCOUNT_PHONE = 'accountPhone';

/** FR-FAKE-01: the server's users, as contacts. */
const DIRECTORY: readonly Contact[] = CONTACTS.map((c) => ({ userId: c.id, name: c.name, phone: c.phone! }));
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
  private dailyLimit = DAILY_LIMIT;
  private transfers = 0;
  private accountPhone: string | undefined;
  /**
   * Kotlin runs backend calls in parallel; here they interleave at every await. Anything that
   * reads and then writes server state runs one at a time through this chain.
   */
  private serial: Promise<unknown> = Promise.resolve();

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
    const result = this.otp.verify(phone, code);
    if (result.outcome === 'VERIFIED') {
      await this.store.setMeta(META_ACCOUNT_PHONE, phone);
      this.accountPhone = phone;
    }
    return result;
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
    this.dailyLimit = Number((await this.store.getMeta(META_DAILY_LIMIT)) ?? DAILY_LIMIT);
    this.transfers = Number((await this.store.getMeta(META_TRANSFERS)) ?? 0);
    this.accountPhone = await this.store.getMeta(META_ACCOUNT_PHONE);
  }

  async reset(config: ServerDataset): Promise<void> {
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
    await this.exclusive(async () => {
      this.frozenNow = config.nowMillis;
      this.simulatedIncoming = 0;
      this.dailyLimit = DAILY_LIMIT;
      this.transfers = 0;
      await this.store.replaceAll([...generateTransactions(config, this.now()), ...extra], {
        [META_SEEDED]: '1',
        [META_FROZEN_NOW]: config.nowMillis === undefined ? '' : String(config.nowMillis),
        [META_SIMULATED_INCOMING]: '0',
        [META_DAILY_LIMIT]: String(DAILY_LIMIT),
        [META_TRANSFERS]: '0',
        // The account outlives a dataset reset.
        ...(this.accountPhone !== undefined ? { [META_ACCOUNT_PHONE]: this.accountPhone } : {}),
      });
    });
  }

  async setDailyLimit(minor: number): Promise<void> {
    if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_AMOUNT_MINOR) {
      throw new CoreError('INVALID_ARGUMENT', 'dailyLimit must be a whole number 0..MAX_AMOUNT_MINOR');
    }
    await this.exclusive(async () => {
      await this.store.setMeta(META_DAILY_LIMIT, String(minor));
      this.dailyLimit = minor;
    });
  }

  /** Tests only: moves a frozen clock forward (pending transfers settle by it). */
  advanceClock(ms: number): void {
    if (this.frozenNow === undefined) throw new CoreError('INVALID_ARGUMENT', 'the clock is not frozen');
    this.frozenNow += ms;
  }

  async searchContacts(query: string): Promise<Contact[]> {
    await this.network.beforeCall();
    return matchDirectory(query, DIRECTORY);
  }

  async getContact(userId: string): Promise<Contact> {
    await this.network.beforeCall();
    const contact = DIRECTORY.find((c) => c.userId === userId);
    if (!contact) throw new CoreError('NOT_FOUND', `No user ${userId}`);
    return contact;
  }

  async transfer(request: TransferRequest, idempotencyKey: string): Promise<Transaction> {
    const hold = await this.network.beforeTransfer();
    // From here the server has the request: it finishes even if the client stops waiting (ADR-0007 §2).
    const tx = await this.exclusive(() => this.applyTransfer(request, idempotencyKey, hold));
    if (hold !== undefined) return new Promise<Transaction>(() => {}); // TIMEOUT: the answer never comes
    return tx;
  }

  async getTransferByKey(idempotencyKey: string): Promise<Transaction> {
    await this.network.beforeCall();
    return this.exclusive(async () => {
      await this.settleDue();
      const key = await this.store.getTransferKey(idempotencyKey);
      const tx = key && (await this.store.get(key.transactionId));
      if (!tx) throw new CoreError('NOT_FOUND', 'No transfer with this key');
      return tx;
    });
  }

  /** FR-FAKE-02/03, ADR-0014 §2. Runs inside `exclusive`. */
  private async applyTransfer(
    request: TransferRequest,
    idempotencyKey: string,
    hold: { holdMs: number; fails: boolean } | undefined,
  ): Promise<Transaction> {
    await this.settleDue();
    const known = await this.store.getTransferKey(idempotencyKey);
    if (known !== undefined) {
      const same =
        known.recipientId === request.recipientId && known.amount === request.amount && known.note === request.note;
      if (!same) throw new CoreError('IDEMPOTENCY_CONFLICT', 'This key was used for a different transfer');
      const original = await this.store.get(known.transactionId);
      if (!original) throw new CoreError('SERVER_ERROR', 'Recorded transfer is missing');
      return original;
    }
    if (idempotencyKey.length === 0) throw new CoreError('INVALID_ARGUMENT', 'idempotencyKey is required');
    if (!isValidTransferAmount(request.amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid transfer amount');
    if (normalizeNote(request.note) !== request.note) throw new CoreError('INVALID_ARGUMENT', 'Invalid note');
    const recipient = DIRECTORY.find((c) => c.userId === request.recipientId);
    if (!recipient) throw new CoreError('RECIPIENT_NOT_FOUND', `No user ${request.recipientId}`);
    if (recipient.phone === this.accountPhone) throw new CoreError('INVALID_ARGUMENT', "You can't send money to yourself");

    const now = this.now();
    const refused = exceededLimit(request.amount, {
      balance: await this.store.balance(),
      dailyRemaining: Math.max(0, this.dailyLimit - (await this.usedToday(now))),
    });
    const n = this.transfers + 1;
    const tx: Transaction = {
      id: `trf-${n}`,
      idempotencyKey,
      type: 'TRANSFER_OUT',
      category: 'TRANSFER',
      amount: request.amount,
      counterparty: { kind: 'USER', id: recipient.userId, name: recipient.name, phone: recipient.phone },
      ...(request.note !== undefined ? { note: request.note } : {}),
      status: refused !== undefined ? 'FAILED' : hold !== undefined ? 'PENDING' : 'SUCCESS',
      ...(refused !== undefined ? { failureReason: refused } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.store.recordTransfer(
      tx,
      { ...request, transactionId: tx.id },
      { [META_TRANSFERS]: String(n) },
      tx.status === 'PENDING' && hold ? { resolveAt: now + hold.holdMs, fails: hold.fails } : undefined,
    );
    this.transfers = n;
    return tx;
  }

  /**
   * FR-FAKE-05: settles held transfers whose time has come, lazily, at the start of each call
   * that reads server state. updatedAt moves forward so the replica's delta sync sees the change
   * even with a frozen clock.
   */
  private async settleDue(): Promise<void> {
    const now = this.now();
    for (const due of await this.store.dueSettlements(now)) {
      const tx = await this.store.get(due.transactionId);
      if (!tx) continue;
      await this.store.settle(
        tx.id,
        due.fails ? 'FAILED' : 'SUCCESS',
        due.fails ? 'SERVER_ERROR' : undefined,
        Math.max(now, tx.updatedAt + 1),
      );
    }
  }

  private async usedToday(now: number): Promise<number> {
    const offsetAt = this.timeZone().offsetAt;
    // FR-TRF-10: the daily limit resets at local midnight in the user's zone (ADR-0006).
    return this.store.usedSince(localMidnight(localEpochDay(now, offsetAt), offsetAt));
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.serial.then(work, work);
    this.serial = run.catch(() => undefined);
    return run;
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
    return this.exclusive(async () => {
      await this.settleDue();
      const now = this.now();
      return {
        id: WALLET_ID,
        balance: await this.store.balance(),
        dailyLimit: this.dailyLimit,
        usedToday: await this.usedToday(now),
        updatedAt: now,
      };
    });
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
    await this.exclusive(() => this.settleDue());
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
    await this.exclusive(() => this.settleDue());
    const tx = await this.store.get(id);
    if (tx === undefined) throw new CoreError('NOT_FOUND', `No transaction ${id}`);
    return tx;
  }
}
