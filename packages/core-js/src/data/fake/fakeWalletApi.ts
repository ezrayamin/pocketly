import { CoreError, MAX_AMOUNT_MINOR } from '@pocketly/core-contract';
import type { Contact, DatasetConfig, OtpSendResult, Transaction, Wallet } from '@pocketly/core-contract';
import { isTopUpMethod, isValidTopUpAmount, topUpCounterparty } from '../../domain/topUpPolicy';
import { exceededLimit, isValidTransferAmount, normalizeNote } from '../../domain/transferPolicy';
import { localEpochDay, localMidnight } from '../../domain/zonedCalendar';
import { matchDirectory } from '../contactSearch';
import { validateTransaction } from '../transactionDtoValidator';
import {
  CONTACTS,
  DAILY_LIMIT,
  MERCHANTS,
  WALLET_ID,
  generateTransactions,
  seedPaymentRequests,
  simulatedIncomingTransfer,
} from '../seedData';
import type { UserTimeZone } from '../timeZone';
import type {
  ChangesPage,
  EventsPage,
  FakeBackendControls,
  PaymentTarget,
  QrPaymentRequest,
  ServerOtpVerify,
  TopUpRequest,
  TransferRequest,
  WalletApi,
  WalletEvent,
} from '../walletApi';
import { NetworkSimulator, type TopUpHandling } from './networkSimulator';
import { OtpServer } from './otpServer';
import type { ServerStore, SettlementRow } from './serverStore';

/** A dataset plus extra seed rows: tests and benchmarks only (BenchCore.resetDataWithExtras). */
export type ServerDataset = DatasetConfig & { extraTransactions?: readonly Transaction[] };

/** Server-side page size cap for getChanges (sync). Same as Kotlin. */
export const MAX_CHANGES_PAGE = 500;
/** Server-side page size cap for getEvents. Same as Kotlin. */
export const MAX_EVENTS_PAGE = 500;

const META_SEEDED = 'seeded';
const META_FROZEN_NOW = 'frozenNowMillis';
const META_SIMULATED_INCOMING = 'simulatedIncoming';
const META_DAILY_LIMIT = 'dailyLimit';
const META_TRANSFERS = 'transfers';
const META_TOP_UPS = 'topUps';
const META_QR_PAYMENTS = 'qrPayments';
/** ADR-0016 §6: the verified account's user id, random, kept with its phone across resets. */
const META_ACCOUNT_USER_ID = 'accountUserId';
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
  private topUps = 0;
  private qrPayments = 0;
  private accountUserId: string | undefined;
  private accountPhone: string | undefined;
  /**
   * Kotlin runs backend calls in parallel; here they interleave at every await. Anything that
   * reads and then writes server state runs one at a time through this chain.
   */
  private serial: Promise<unknown> = Promise.resolve();
  /** incomingEvents listeners (ADR-0017 §1). */
  private readonly eventListeners = new Set<() => void>();
  /** App mode only: one timer per held or processing transaction, settling it on time (ADR-0017 §1). */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  private readonly otp: OtpServer;

  constructor(
    private readonly store: ServerStore,
    private readonly timeZone: () => UserTimeZone,
    /** The OTP side's clock (ADR-0013): the device's, not the dataset's frozen one. */
    otpClock: () => number = Date.now,
    /** For the account's user id (ADR-0016 §6). The app passes its secure generator. */
    private readonly randomBytes: (size: number) => Uint8Array = (size) =>
      Uint8Array.from({ length: size }, () => Math.floor(Math.random() * 256)),
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
    if (result.outcome !== 'VERIFIED') return result;
    // The same phone keeps its id; another phone is another account.
    const kept = phone === this.accountPhone ? this.accountUserId : undefined;
    const userId = kept ?? this.newUserId();
    await this.store.setMeta(META_ACCOUNT_PHONE, phone);
    await this.store.setMeta(META_ACCOUNT_USER_ID, userId);
    this.accountPhone = phone;
    this.accountUserId = userId;
    return { ...result, userId };
  }

  async getAccountUserId(phone: string): Promise<string> {
    await this.network.beforeCall();
    return this.exclusive(async () => {
      if (this.accountPhone === undefined) {
        // Verified before this server recorded the account (slice 5): the session's phone is it.
        await this.store.setMeta(META_ACCOUNT_PHONE, phone);
        this.accountPhone = phone;
      }
      if (phone !== this.accountPhone) throw new CoreError('NOT_FOUND', 'Not this account');
      if (this.accountUserId === undefined) {
        // Verified before user ids existed: the account gets one now.
        this.accountUserId = this.newUserId();
        await this.store.setMeta(META_ACCOUNT_USER_ID, this.accountUserId);
      }
      return this.accountUserId;
    });
  }

  /** `u-` + 12 random hex digits: says nothing about the phone (ADR-0016 §6). */
  private newUserId(): string {
    return `u-${Array.from(this.randomBytes(6), (b) => b.toString(16).padStart(2, '0')).join('')}`;
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
    this.topUps = Number((await this.store.getMeta(META_TOP_UPS)) ?? 0);
    this.qrPayments = Number((await this.store.getMeta(META_QR_PAYMENTS)) ?? 0);
    this.accountUserId = await this.store.getMeta(META_ACCOUNT_USER_ID);
    this.accountPhone = await this.store.getMeta(META_ACCOUNT_PHONE);
    // What was held when the process died settles now if it's due, else on time (ADR-0017 §1).
    for (const due of await this.store.dueSettlements(Number.MAX_SAFE_INTEGER)) {
      this.scheduleSettlement(due.transactionId, due.resolveAt);
    }
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
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
      this.frozenNow = config.nowMillis;
      this.simulatedIncoming = 0;
      this.dailyLimit = DAILY_LIMIT;
      this.transfers = 0;
      this.topUps = 0;
      this.qrPayments = 0;
      const now = this.now();
      await this.store.replaceAll([...generateTransactions(config, now), ...extra], seedPaymentRequests(now), {
        [META_SEEDED]: '1',
        [META_FROZEN_NOW]: config.nowMillis === undefined ? '' : String(config.nowMillis),
        [META_SIMULATED_INCOMING]: '0',
        [META_DAILY_LIMIT]: String(DAILY_LIMIT),
        [META_TRANSFERS]: '0',
        [META_TOP_UPS]: '0',
        [META_QR_PAYMENTS]: '0',
        // The account outlives a dataset reset.
        ...(this.accountPhone !== undefined ? { [META_ACCOUNT_PHONE]: this.accountPhone } : {}),
        ...(this.accountUserId !== undefined ? { [META_ACCOUNT_USER_ID]: this.accountUserId } : {}),
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

  /**
   * Tests only: moves a frozen clock forward, and settles what that makes due, as the app's timers
   * would (ADR-0017 §1). The settling runs in the background: the next server call waits for it.
   */
  advanceClock(ms: number): void {
    if (this.frozenNow === undefined) throw new CoreError('INVALID_ARGUMENT', 'the clock is not frozen');
    this.frozenNow += ms;
    this.exclusive(() => this.settleDue()).catch(() => undefined);
  }

  incomingEvents(listener: () => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async getEvents(afterSeq: number, limit: number): Promise<EventsPage> {
    await this.network.beforeEventRead();
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new CoreError('INVALID_ARGUMENT', 'afterSeq must be >= 0');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS_PAGE) {
      throw new CoreError('INVALID_ARGUMENT', `limit must be 1..${MAX_EVENTS_PAGE}`);
    }
    return this.exclusive(async () => {
      await this.settleDue();
      const rows = await this.store.eventsAfter(afterSeq, limit + 1);
      const items: WalletEvent[] = [];
      for (const row of rows.slice(0, limit)) {
        const transaction = await this.store.get(row.transactionId);
        if (!transaction) throw new CoreError('SERVER_ERROR', `Logged transaction ${row.transactionId} is missing`);
        items.push({ seq: row.seq, kind: row.kind, transaction, createdAt: row.createdAt });
      }
      return { items, hasMore: rows.length > limit };
    });
  }

  /** "The log grew", after the write that grew it: asynchronous, as from a socket. */
  private signal(): void {
    if (this.eventListeners.size === 0) return;
    setTimeout(() => {
      for (const listener of this.eventListeners) listener();
    }, 0);
  }

  /**
   * App mode: settles this transaction when its time comes (FR-FAKE-05), so its event appears while the
   * app runs. A frozen clock (tests) has no timers: advanceClock settles instead.
   */
  private scheduleSettlement(transactionId: string, resolveAt: number): void {
    if (this.frozenNow !== undefined) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.exclusive(async () => {
        await this.settleDue();
        const left = await this.store.getSettlement(transactionId);
        if (left) this.scheduleSettlement(transactionId, left.resolveAt); // woke a little early
      }).catch(() => undefined);
    }, Math.max(0, resolveAt - Date.now()));
    (timer as { unref?: () => void }).unref?.(); // Node: never keeps a test process alive
    this.timers.add(timer);
  }

  async searchContacts(query: string): Promise<Contact[]> {
    await this.network.beforeCall();
    return matchDirectory(query, DIRECTORY);
  }

  async getContact(userId: string): Promise<Contact> {
    await this.network.beforeCall();
    // This account, from a scanned My QR (ADR-0016 §6): the client refuses it by its phone.
    if (userId === this.accountUserId && this.accountPhone !== undefined) {
      return { userId, name: 'You', phone: this.accountPhone };
    }
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

  async topUp(request: TopUpRequest, idempotencyKey: string): Promise<Transaction> {
    const handling = await this.network.beforeTopUp();
    // From here the server has the request: it finishes even if the client stops waiting (ADR-0007 §2).
    const { tx, recorded } = await this.exclusive(() => this.applyTopUp(request, idempotencyKey, handling));
    if (handling.kind === 'HOLD') return new Promise<Transaction>(() => {}); // TIMEOUT: the answer never comes
    if (!recorded) return tx; // a replay: the transaction as it is now
    // Processing runs outside the lock: a retry or status check meanwhile finds it PENDING.
    if (handling.processingMs > 0) await new Promise((resolve) => setTimeout(resolve, handling.processingMs));
    return this.exclusive(() => this.settleProcessed(tx));
  }

  async getPaymentTarget(merchantId: string, requestId?: string): Promise<PaymentTarget> {
    await this.network.beforeCall();
    return this.exclusive(async () => {
      await this.settleDue();
      return this.paymentTarget(merchantId, requestId);
    });
  }

  async payMerchant(request: QrPaymentRequest, idempotencyKey: string): Promise<Transaction> {
    const hold = await this.network.beforeTransfer();
    // From here the server has the request: it finishes even if the client stops waiting (ADR-0007 §2).
    const tx = await this.exclusive(() => this.applyQrPayment(request, idempotencyKey, hold));
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
        known.recipientId === request.recipientId &&
        known.amount === request.amount &&
        known.note === request.note &&
        known.requestId === undefined;
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
    if (tx.status === 'PENDING' && hold) this.scheduleSettlement(tx.id, now + hold.holdMs);
    return tx;
  }

  /** ADR-0016 §4: the merchant, and its request if any. Runs inside `exclusive`. */
  private async paymentTarget(merchantId: string, requestId: string | undefined): Promise<PaymentTarget> {
    const merchant = MERCHANTS.find((m) => m.counterparty.id === merchantId);
    if (!merchant) throw new CoreError('INVALID_QR', `No merchant ${merchantId}`);
    const target: PaymentTarget = { merchant: { ...merchant.counterparty }, category: merchant.category };
    if (requestId === undefined) return target;
    const request = await this.store.getPaymentRequest(requestId);
    if (!request || request.merchantId !== merchantId) throw new CoreError('INVALID_QR', `No request ${requestId}`);
    if (request.paidBy !== undefined) throw new CoreError('QR_ALREADY_PAID', 'This code was paid already');
    if (request.expiresAt <= this.now()) throw new CoreError('QR_EXPIRED', 'This code has expired');
    return { ...target, request: { id: request.id, amount: request.amount, expiresAt: request.expiresAt } };
  }

  /** FR-QR-04, ADR-0016 §4: as applyTransfer, for a merchant. Runs inside `exclusive`. */
  private async applyQrPayment(
    request: QrPaymentRequest,
    idempotencyKey: string,
    hold: { holdMs: number; fails: boolean } | undefined,
  ): Promise<Transaction> {
    await this.settleDue();
    const known = await this.store.getTransferKey(idempotencyKey);
    if (known !== undefined) {
      const same =
        known.recipientId === request.merchantId &&
        known.amount === request.amount &&
        known.note === undefined &&
        known.requestId === request.requestId;
      if (!same) throw new CoreError('IDEMPOTENCY_CONFLICT', 'This key was used for a different request');
      const original = await this.store.get(known.transactionId);
      if (!original) throw new CoreError('SERVER_ERROR', 'Recorded QR payment is missing');
      return original;
    }
    if (idempotencyKey.length === 0) throw new CoreError('INVALID_ARGUMENT', 'idempotencyKey is required');
    const target = await this.paymentTarget(request.merchantId, request.requestId);
    if (!isValidTransferAmount(request.amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid payment amount');
    if (target.request !== undefined && target.request.amount !== request.amount) {
      throw new CoreError('INVALID_ARGUMENT', "The amount isn't the code's");
    }

    const now = this.now();
    const refused = exceededLimit(request.amount, {
      balance: await this.store.balance(),
      dailyRemaining: Math.max(0, this.dailyLimit - (await this.usedToday(now))),
    });
    const n = this.qrPayments + 1;
    const tx: Transaction = {
      id: `qrp-${n}`,
      idempotencyKey,
      type: 'QR_PAYMENT',
      category: target.category,
      amount: request.amount,
      counterparty: target.merchant,
      status: refused !== undefined ? 'FAILED' : hold !== undefined ? 'PENDING' : 'SUCCESS',
      ...(refused !== undefined ? { failureReason: refused } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.store.recordTransfer(
      tx,
      {
        recipientId: request.merchantId,
        amount: request.amount,
        transactionId: tx.id,
        ...(request.requestId !== undefined ? { requestId: request.requestId } : {}),
      },
      { [META_QR_PAYMENTS]: String(n) },
      tx.status === 'PENDING' && hold ? { resolveAt: now + hold.holdMs, fails: hold.fails } : undefined,
      refused === undefined ? request.requestId : undefined, // paid (or held): nobody pays it again
    );
    this.qrPayments = n;
    if (tx.status === 'PENDING' && hold) this.scheduleSettlement(tx.id, now + hold.holdMs);
    return tx;
  }

  /**
   * ADR-0015 §4. Runs inside `exclusive`. A new top-up is recorded PENDING with a settlement row
   * saying how it ends, so one still processing when the app dies settles on the next start.
   */
  private async applyTopUp(
    request: TopUpRequest,
    idempotencyKey: string,
    handling: TopUpHandling,
  ): Promise<{ tx: Transaction; recorded: boolean }> {
    await this.settleDue();
    if (!isTopUpMethod(request.method)) throw new CoreError('INVALID_ARGUMENT', 'Unknown top-up method');
    const counterparty = topUpCounterparty(request.method);
    const known = await this.store.getTransferKey(idempotencyKey);
    if (known !== undefined) {
      const same =
        known.recipientId === counterparty.id &&
        known.amount === request.amount &&
        known.note === undefined &&
        known.requestId === undefined;
      if (!same) throw new CoreError('IDEMPOTENCY_CONFLICT', 'This key was used for a different request');
      const original = await this.store.get(known.transactionId);
      if (!original) throw new CoreError('SERVER_ERROR', 'Recorded top-up is missing');
      return { tx: original, recorded: false };
    }
    if (idempotencyKey.length === 0) throw new CoreError('INVALID_ARGUMENT', 'idempotencyKey is required');
    if (!isValidTopUpAmount(request.amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid top-up amount');

    const now = this.now();
    const n = this.topUps + 1;
    const tx: Transaction = {
      id: `tup-${n}`,
      idempotencyKey,
      type: 'TOP_UP',
      category: 'TOP_UP',
      amount: request.amount,
      counterparty,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    const waitMs = handling.kind === 'HOLD' ? handling.holdMs : handling.processingMs;
    const fails = handling.declined || (handling.kind === 'HOLD' && handling.fails);
    await this.store.recordTransfer(
      tx,
      { recipientId: counterparty.id, amount: request.amount, transactionId: tx.id },
      { [META_TOP_UPS]: String(n) },
      { resolveAt: now + waitMs, fails, ...(handling.declined ? { failureReason: 'PAYMENT_DECLINED' as const } : {}) },
    );
    this.topUps = n;
    // A processing one settles when its answer goes out; the timer is for a process that died meanwhile.
    this.scheduleSettlement(tx.id, now + waitMs);
    return { tx, recorded: true };
  }

  /** After processing: settles this top-up by its row, unless something settled it already. Inside `exclusive`. */
  private async settleProcessed(tx: Transaction): Promise<Transaction> {
    const current = await this.store.get(tx.id);
    if (current === undefined || current.idempotencyKey !== tx.idempotencyKey) return tx; // reset meanwhile
    const due = await this.store.getSettlement(tx.id);
    if (due === undefined) return current;
    return this.settleRow(due, current, this.now());
  }

  /**
   * FR-FAKE-05: settles held transfers and top-ups whose time has come, lazily, at the start of
   * each call that reads server state.
   */
  private async settleDue(): Promise<void> {
    const now = this.now();
    for (const due of await this.store.dueSettlements(now)) {
      const tx = await this.store.get(due.transactionId);
      if (tx) await this.settleRow(due, tx, now);
    }
  }

  /** updatedAt moves forward so the replica's delta sync sees the change even with a frozen clock. */
  private async settleRow(due: SettlementRow, tx: Transaction, now: number): Promise<Transaction> {
    const status = due.fails ? 'FAILED' : 'SUCCESS';
    const failureReason = due.fails ? (due.failureReason ?? 'SERVER_ERROR') : undefined;
    const updatedAt = Math.max(now, tx.updatedAt + 1);
    await this.store.settle(tx.id, status, failureReason, updatedAt);
    this.signal();
    return { ...tx, status, ...(failureReason !== undefined ? { failureReason } : {}), updatedAt };
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

  /** FR-DEV-04: the transfer and its MONEY_RECEIVED event, in one write (ADR-0017 §1). */
  simulateIncomingTransfer(): Promise<Transaction> {
    return this.exclusive(async () => {
      const n = this.simulatedIncoming + 1;
      const tx = simulatedIncomingTransfer(n, this.now());
      await this.store.insertIncoming(tx, { [META_SIMULATED_INCOMING]: String(n) });
      this.simulatedIncoming = n;
      this.signal();
      return tx;
    });
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
