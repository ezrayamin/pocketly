import {
  CoreError,
  RECENT_CONTACTS_LIMIT,
  TOP_UP_FEE_MINOR,
  TRANSFER_FEE_MINOR,
  TRANSFER_MIN_MINOR,
  toCoreError,
} from '@pocketly/core-contract';
import type {
  AmountCheck,
  Category,
  Contact,
  ContactSearch,
  Counterparty,
  ErrorCode,
  QrPaymentDraft,
  QrPaymentReview,
  TopUpMethod,
  TopUpReview,
  Transaction,
  TransferAuth,
  TransferAuthOutcome,
  TransferDraft,
  TransferEvent,
  TransferResult,
  TransferReview,
  TransferState,
  Wallet,
} from '@pocketly/core-contract';
import { PLACEHOLDER_PREFIX, type CacheStore } from '../data/cacheStore';
import { searchDirectory } from '../data/contactSearch';
import type { WalletApi } from '../data/walletApi';
import { isTopUpMethod, isValidTopUpAmount, topUpCounterparty, topUpMethodOf } from '../domain/topUpPolicy';
import { checkTransferAmount, exceededLimit, isRetryable, isValidTransferAmount, normalizeNote } from '../domain/transferPolicy';
import { transition } from '../domain/transferStateMachine';
import type { BiometricAuth } from '../security/biometricAuth';
import type { PinAuth } from '../security/pinAuth';

/** One attempt (FR-TRF-05): one key, one approval. Its id is its idempotency key. */
interface AttemptBase {
  readonly key: string;
  readonly amount: number;
  state: TransferState;
  failureReason?: ErrorCode;
  retryable?: boolean;
  transaction?: Transaction;
  /** The confirm or status check running now: a second call joins it (double tap). */
  running?: Promise<TransferResult>;
}

interface TransferAttempt extends AttemptBase {
  readonly kind: 'TRANSFER';
  readonly recipient: Contact;
  readonly note?: string;
}

/** ADR-0015: money in from a payment method; no approval in Pocketly (§2). */
interface TopUpAttempt extends AttemptBase {
  readonly kind: 'TOP_UP';
  readonly method: TopUpMethod;
}

/** ADR-0016: money out to a merchant, approved like a transfer. */
interface QrAttempt extends AttemptBase {
  readonly kind: 'QR_PAYMENT';
  readonly merchant: Counterparty;
  /** The merchant's, from the server: the pending row's category. */
  readonly category: Category;
  readonly requestId?: string;
}

type Attempt = TransferAttempt | TopUpAttempt | QrAttempt;

/** A change to the replica's wallet: balance, and today's outgoing total. */
type WalletDelta = readonly [balance: number, usedToday: number];

/** The amount step's limits, fresh from the server. One draft at a time: a transfer's or a QR payment's. */
type Draft =
  | { kind: 'TRANSFER'; recipient: Contact; balance: number; dailyRemaining: number }
  | {
      kind: 'QR_PAYMENT';
      merchant: Counterparty;
      category: Category;
      /** A dynamic code's open request: its amount is the only one allowed. */
      request?: { id: string; amount: number; expiresAt: number };
      balance: number;
      dailyRemaining: number;
    };

export interface PaymentFlowDeps {
  /** Behind the timeout (NFR-REL-01): reads after readTimeoutMs, the submission after writeTimeoutMs. */
  api: WalletApi;
  cache: CacheStore;
  pin: PinAuth;
  biometric: BiometricAuth;
  /** From the server, into the replica (jsCore.fetchWallet). */
  fetchWallet: () => Promise<Wallet>;
  randomBytes: (size: number) => Uint8Array;
  /** Device clock, for the app's own pending rows. */
  clock: () => number;
}

/**
 * F5, the client side of a transfer (ADR-0014): draft → review (the key) → confirm (approval,
 * submission, 15 s) → SUCCESS / FAILED / PENDING → status check. F6's top-ups (ADR-0015) and F7's
 * QR payments (ADR-0016) are attempts too, with the same outcomes: a top-up needs no approval, a
 * QR payment is approved like a transfer. Every state change goes through the §3.2 state machine.
 * Mirrors shared/.../sync/PaymentFlow.kt.
 */
export class PaymentFlow {
  private draft: Draft | undefined;
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly deps: PaymentFlowDeps) {}

  /** Logout / resetData: forget the draft and every attempt (the replica is cleared too). */
  reset(): void {
    this.draft = undefined;
    this.attempts.clear();
  }

  async searchContacts(query: string): Promise<ContactSearch> {
    const [self, directory] = await Promise.all([this.deps.pin.verifiedPhone(), this.deps.api.searchContacts(query)]);
    const { contacts, phoneLookup } = searchDirectory(query, directory, self);
    const recent =
      query.trim().length === 0
        ? (await this.deps.cache.recentRecipients(RECENT_CONTACTS_LIMIT + 1)).filter((c) => c.phone !== self).slice(0, RECENT_CONTACTS_LIMIT)
        : [];
    return phoneLookup === undefined ? { recent, contacts } : { recent, contacts, phoneLookup };
  }

  /**
   * The recipient, this install's phone and a fresh wallet, fetched in parallel (none needs
   * another; BM-07 first measured them one after the other). Failures are reported in a fixed
   * order (recipient, phone, wallet), so both cores fail the same way whichever call ends first.
   */
  async startTransfer(recipientId: string): Promise<TransferDraft> {
    const [contact, self, fresh] = await Promise.allSettled([
      this.deps.api.getContact(recipientId),
      this.deps.pin.verifiedPhone(),
      this.deps.fetchWallet(), // FR-TRF-11: fresh, or no transfer
    ]);
    if (contact.status === 'rejected') {
      const error = toCoreError(contact.reason);
      throw error.code === 'NOT_FOUND' ? new CoreError('RECIPIENT_NOT_FOUND', `No user ${recipientId}`) : error;
    }
    const recipient = contact.value;
    if (self.status === 'rejected') throw toCoreError(self.reason);
    if (recipient.phone === self.value) throw new CoreError('INVALID_ARGUMENT', "You can't send money to yourself");
    if (fresh.status === 'rejected') throw toCoreError(fresh.reason);
    const wallet = fresh.value;
    const draft = {
      kind: 'TRANSFER' as const,
      recipient,
      balance: wallet.balance,
      dailyRemaining: Math.max(0, wallet.dailyLimit - wallet.usedToday),
    };
    this.draft = draft;
    return {
      recipient,
      balance: draft.balance,
      dailyRemaining: draft.dailyRemaining,
      minAmount: TRANSFER_MIN_MINOR,
      maxAmount: Math.min(draft.balance, draft.dailyRemaining),
    };
  }

  checkTransferAmount(text: string): AmountCheck {
    return checkTransferAmount(text, this.currentDraft());
  }

  async reviewTransfer(amount: number, note?: string): Promise<TransferReview> {
    const draft = this.currentDraft();
    if (draft.kind !== 'TRANSFER') throw new CoreError('NOT_FOUND', 'No transfer started');
    if (!isValidTransferAmount(amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid transfer amount');
    const over = exceededLimit(amount, draft);
    if (over !== undefined) throw new CoreError(over, 'Amount is over the limit');
    const normalized = normalizeNote(note);
    const key = this.newAttemptKey();
    this.attempts.set(key, {
      kind: 'TRANSFER',
      key,
      recipient: draft.recipient,
      amount,
      note: normalized,
      state: 'DRAFT',
    });
    return {
      id: key,
      idempotencyKey: key,
      recipient: draft.recipient,
      amount,
      fee: TRANSFER_FEE_MINOR,
      ...(normalized !== undefined ? { note: normalized } : {}),
      balanceAfter: draft.balance - amount,
    };
  }

  /**
   * FR-QR-03 (ADR-0016 §4): the merchant and its request, and a fresh wallet, in parallel. The
   * server's answer is reported first, so both cores fail the same way whichever call ends first.
   */
  async startQrPayment(merchantId: string, requestId?: string): Promise<QrPaymentDraft> {
    const [target, fresh] = await Promise.allSettled([
      this.deps.api.getPaymentTarget(merchantId, requestId),
      this.deps.fetchWallet(), // as FR-TRF-11: fresh, or no payment
    ]);
    if (target.status === 'rejected') throw toCoreError(target.reason);
    if (fresh.status === 'rejected') throw toCoreError(fresh.reason);
    const { merchant, category, request } = target.value;
    const wallet = fresh.value;
    const draft: Draft = {
      kind: 'QR_PAYMENT',
      merchant,
      category,
      ...(request !== undefined ? { request } : {}),
      balance: wallet.balance,
      dailyRemaining: Math.max(0, wallet.dailyLimit - wallet.usedToday),
    };
    this.draft = draft;
    return {
      merchant,
      ...(request !== undefined ? { requestId: request.id, amount: request.amount, expiresAt: request.expiresAt } : {}),
      balance: draft.balance,
      dailyRemaining: draft.dailyRemaining,
      minAmount: TRANSFER_MIN_MINOR,
      maxAmount: Math.min(draft.balance, draft.dailyRemaining),
    };
  }

  async reviewQrPayment(amount: number): Promise<QrPaymentReview> {
    const draft = this.currentDraft();
    if (draft.kind !== 'QR_PAYMENT') throw new CoreError('NOT_FOUND', 'No QR payment started');
    if (!isValidTransferAmount(amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid payment amount');
    if (draft.request !== undefined && draft.request.amount !== amount) {
      throw new CoreError('INVALID_ARGUMENT', "The amount isn't the code's");
    }
    const over = exceededLimit(amount, draft);
    if (over !== undefined) throw new CoreError(over, 'Amount is over the limit');
    const key = this.newAttemptKey();
    const requestId = draft.request?.id;
    this.attempts.set(key, {
      kind: 'QR_PAYMENT',
      key,
      merchant: draft.merchant,
      category: draft.category,
      ...(requestId !== undefined ? { requestId } : {}),
      amount,
      state: 'DRAFT',
    });
    return {
      id: key,
      idempotencyKey: key,
      merchant: draft.merchant,
      ...(requestId !== undefined ? { requestId } : {}),
      amount,
      fee: TRANSFER_FEE_MINOR,
      balanceAfter: draft.balance - amount,
    };
  }

  /** FR-TOP-01/02: a fresh wallet (FR-TRF-11: no top-up from cached data), then the attempt and its key. */
  async reviewTopUp(amount: number, method: TopUpMethod): Promise<TopUpReview> {
    if (!isTopUpMethod(method)) throw new CoreError('INVALID_ARGUMENT', 'Unknown top-up method');
    if (!isValidTopUpAmount(amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid top-up amount');
    const wallet = await this.deps.fetchWallet();
    const key = this.newAttemptKey();
    this.attempts.set(key, { kind: 'TOP_UP', key, method, amount, state: 'DRAFT' });
    const balanceAfter = wallet.balance + amount;
    return { id: key, idempotencyKey: key, method, amount, fee: TOP_UP_FEE_MINOR, balanceAfter };
  }

  async confirmTransfer(id: string, auth?: TransferAuth): Promise<TransferResult> {
    const attempt = await this.attempt(id);
    if (attempt.running) return attempt.running;
    if (attempt.state === 'DRAFT' && attempt.kind !== 'TOP_UP' && auth === undefined) {
      throw new CoreError('INVALID_ARGUMENT', 'A new payment needs biometrics or the PIN');
    }
    if (attempt.state === 'DRAFT' && attempt.kind === 'TOP_UP' && auth !== undefined) {
      throw new CoreError('INVALID_ARGUMENT', 'A top-up takes no authorization');
    }
    if (attempt.state !== 'DRAFT' && !(attempt.state === 'FAILED' && attempt.retryable)) {
      return this.result(attempt, 'NOT_REQUIRED');
    }
    return this.run(attempt, () => {
      if (attempt.state !== 'DRAFT') return this.retry(attempt);
      return attempt.kind === 'TOP_UP' ? this.sendTopUp(attempt) : this.authorizeAndSend(attempt, auth!);
    });
  }

  async getTransferStatus(id: string): Promise<TransferResult> {
    const attempt = await this.attempt(id);
    if (attempt.running) return attempt.running;
    if (attempt.state !== 'PENDING') return this.result(attempt, 'NOT_REQUIRED');
    return this.run(attempt, () => this.checkStatus(attempt));
  }

  // ── steps ────────────────────────────────────────────────────────────

  private async authorizeAndSend(attempt: TransferAttempt | QrAttempt, auth: TransferAuth): Promise<TransferResult> {
    this.move(attempt, 'CONFIRM');
    let outcome: TransferAuthOutcome;
    let extra: Pick<TransferResult, 'attemptsLeft' | 'lockedUntil'> = {};
    try {
      ({ outcome, extra } = await this.authorize(attempt, auth));
    } catch (e) {
      this.move(attempt, 'CANCEL');
      throw e;
    }
    if (outcome !== 'OK') {
      this.move(attempt, 'CANCEL'); // FR-TRF-04: back to review, nothing sent
      return { ...this.result(attempt, outcome), ...extra };
    }
    this.move(attempt, 'AUTH_OK');
    return this.submit(attempt, 'OK');
  }

  /** ADR-0015 §2: AUTHORIZING passes at once; the payment method authorizes the charge itself. */
  private sendTopUp(attempt: TopUpAttempt): Promise<TransferResult> {
    this.move(attempt, 'CONFIRM');
    this.move(attempt, 'AUTH_OK');
    return this.submit(attempt, 'NOT_REQUIRED');
  }

  private async authorize(
    attempt: TransferAttempt | QrAttempt,
    auth: TransferAuth,
  ): Promise<{ outcome: TransferAuthOutcome; extra: Pick<TransferResult, 'attemptsLeft' | 'lockedUntil'> }> {
    if (auth.method === 'BIOMETRIC') {
      if (auth.prompt === undefined) throw new CoreError('INVALID_ARGUMENT', 'BIOMETRIC needs a prompt');
      // Each kind signs its own message (ADR-0012, ADR-0016 §2).
      const outcome =
        attempt.kind === 'TRANSFER'
          ? await this.deps.biometric.approveTransfer(
              { amount: attempt.amount, recipientId: attempt.recipient.userId, idempotencyKey: attempt.key },
              auth.prompt,
            )
          : await this.deps.biometric.approveQrPayment(
              {
                amount: attempt.amount,
                merchantId: attempt.merchant.id,
                ...(attempt.requestId !== undefined ? { requestId: attempt.requestId } : {}),
                idempotencyKey: attempt.key,
              },
              auth.prompt,
            );
      return { outcome, extra: {} };
    }
    if (auth.method !== 'PIN' || auth.pin === undefined) throw new CoreError('INVALID_ARGUMENT', 'PIN needs a pin');
    const check = await this.deps.pin.verifyPin(auth.pin);
    if (check.outcome === 'UNLOCKED') return { outcome: 'OK', extra: {} };
    if (check.outcome === 'WRONG_PIN') return { outcome: 'WRONG_PIN', extra: { attemptsLeft: check.attemptsLeft } };
    return { outcome: 'PIN_LOCKED_OUT', extra: check.lockedUntil !== undefined ? { lockedUntil: check.lockedUntil } : {} };
  }

  private retry(attempt: Attempt): Promise<TransferResult> {
    this.move(attempt, 'RETRY');
    attempt.failureReason = undefined;
    attempt.retryable = undefined;
    return this.submit(attempt, 'NOT_REQUIRED');
  }

  /** SUBMITTING → SUCCESS / FAILED / PENDING (ADR-0014 §2, §4). */
  private async submit(attempt: Attempt, auth: TransferAuthOutcome): Promise<TransferResult> {
    let tx: Transaction;
    try {
      tx = await this.send(attempt);
    } catch (e) {
      const error = toCoreError(e);
      if (error.code === 'NETWORK_TIMEOUT') return this.timedOut(attempt, auth);
      this.move(attempt, 'SUBMIT_ERROR');
      attempt.failureReason = error.code;
      // Thrown before the server recorded anything: safe to send again only for these codes.
      attempt.retryable = isRetryable(error.code);
      return { ...this.result(attempt, auth), balance: await this.cachedBalance() };
    }
    return this.applyServerAnswer(attempt, tx, auth, 'SUBMIT_OK', 'SUBMIT_ERROR');
  }

  /** FR-TRF-09: no answer in time. The app shows its own pending row until the server's arrives. */
  private async timedOut(attempt: Attempt, auth: TransferAuthOutcome): Promise<TransferResult> {
    this.move(attempt, 'TIMEOUT');
    const placeholder = this.placeholder(attempt);
    if ((await this.deps.cache.getByIdempotencyKey(attempt.key)) === undefined) {
      await this.deps.cache.upsert(placeholder);
      await this.adjustWallet(heldDelta(attempt)); // as the server counts it while pending
    }
    attempt.transaction = (await this.deps.cache.getByIdempotencyKey(attempt.key)) ?? placeholder;
    return { ...this.result(attempt, auth), balance: await this.cachedBalance() };
  }

  private async checkStatus(attempt: Attempt): Promise<TransferResult> {
    let tx: Transaction;
    try {
      tx = await this.deps.api.getTransferByKey(attempt.key);
    } catch (e) {
      const error = toCoreError(e);
      if (error.code !== 'NOT_FOUND') throw error; // can't tell yet: stays PENDING
      // The request never reached the server: nothing was applied, so sending it again is safe.
      this.move(attempt, 'STATUS_FAILED');
      attempt.failureReason = 'NETWORK_TIMEOUT';
      attempt.retryable = true;
      attempt.transaction = undefined;
      await this.dropPlaceholder(attempt);
      return { ...this.result(attempt, 'NOT_REQUIRED'), balance: await this.cachedBalance() };
    }
    if (tx.status === 'PENDING') {
      await this.deps.cache.upsert(tx);
      attempt.transaction = tx;
      return { ...this.result(attempt, 'NOT_REQUIRED'), balance: await this.cachedBalance() };
    }
    return this.applyServerAnswer(attempt, tx, 'NOT_REQUIRED', 'STATUS_SUCCESS', 'STATUS_FAILED');
  }

  /** The server's transaction for this key: SUCCESS, FAILED (recorded: never retryable) or PENDING. */
  private async applyServerAnswer(
    attempt: Attempt,
    tx: Transaction,
    auth: TransferAuthOutcome,
    ok: TransferEvent,
    failed: TransferEvent,
  ): Promise<TransferResult> {
    const wasHeld = attempt.state === 'PENDING';
    if (tx.status === 'PENDING') return this.timedOut(attempt, auth); // a replay of a held transfer
    await this.deps.cache.upsert(tx); // history row (and the placeholder goes)
    attempt.transaction = tx;
    // ADR-0014 §5, ADR-0015 §3: the replica moves at once, by what this answer adds to what's held.
    const held = wasHeld ? heldDelta(attempt) : NO_CHANGE;
    if (tx.status === 'SUCCESS') {
      this.move(attempt, ok);
      const settled = settledDelta(attempt);
      await this.adjustWallet([settled[0] - held[0], settled[1] - held[1]]);
    } else {
      this.move(attempt, failed);
      attempt.failureReason = tx.failureReason ?? 'SERVER_ERROR';
      attempt.retryable = false; // the server recorded it: the same key returns this again
      await this.adjustWallet([-held[0], -held[1]]); // released
    }
    return { ...this.result(attempt, auth), balance: await this.cachedBalance() };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private currentDraft(): Draft {
    if (this.draft === undefined) throw new CoreError('NOT_FOUND', 'No transfer started');
    return this.draft;
  }

  /** Attempts never sent go: a new review is a new attempt (ADR-0014 §2). */
  private newAttemptKey(): string {
    for (const [id, a] of this.attempts) if (a.state === 'DRAFT' && a.running === undefined) this.attempts.delete(id);
    return uuidV4(this.deps.randomBytes(16));
  }

  private send(attempt: Attempt): Promise<Transaction> {
    const { key, amount } = attempt;
    if (attempt.kind === 'TOP_UP') return this.deps.api.topUp({ method: attempt.method, amount }, key);
    if (attempt.kind === 'QR_PAYMENT') {
      const { merchant, requestId } = attempt;
      const request = { merchantId: merchant.id, ...(requestId !== undefined ? { requestId } : {}), amount };
      return this.deps.api.payMerchant(request, key);
    }
    const { recipient, note } = attempt;
    const request = { recipientId: recipient.userId, amount, ...(note !== undefined ? { note } : {}) };
    return this.deps.api.transfer(request, key);
  }

  /** FR-TRF-09: the app's own pending row, until the server's arrives. */
  private placeholder(attempt: Attempt): Transaction {
    const now = this.deps.clock();
    const common = {
      id: `${PLACEHOLDER_PREFIX}${attempt.key}`,
      idempotencyKey: attempt.key,
      amount: attempt.amount,
      status: 'PENDING' as const,
      createdAt: now,
      updatedAt: now,
    };
    if (attempt.kind === 'TOP_UP') {
      return { ...common, type: 'TOP_UP', category: 'TOP_UP', counterparty: topUpCounterparty(attempt.method) };
    }
    if (attempt.kind === 'QR_PAYMENT') {
      return { ...common, type: 'QR_PAYMENT', category: attempt.category, counterparty: attempt.merchant };
    }
    const { recipient, note } = attempt;
    return {
      ...common,
      type: 'TRANSFER_OUT',
      category: 'TRANSFER',
      counterparty: { kind: 'USER', id: recipient.userId, name: recipient.name, phone: recipient.phone },
      ...(note !== undefined ? { note } : {}),
    };
  }

  /** In memory, or a pending one rebuilt from the replica after a restart (NFR-REL-03). */
  private async attempt(id: string): Promise<Attempt> {
    const known = this.attempts.get(id);
    if (known) return known;
    const row = await this.deps.cache.getByIdempotencyKey(id);
    const method = row?.type === 'TOP_UP' ? topUpMethodOf(row.counterparty) : undefined;
    const merchant = row?.type === 'QR_PAYMENT' && row.counterparty?.kind === 'MERCHANT' ? row.counterparty : undefined;
    if (
      row === undefined ||
      row.counterparty === undefined ||
      (row.type !== 'TRANSFER_OUT' && method === undefined && merchant === undefined)
    ) {
      throw new CoreError('NOT_FOUND', `No transfer ${id}`);
    }
    const common = {
      key: id,
      amount: row.amount,
      state: row.status === 'PENDING' ? 'PENDING' : row.status === 'SUCCESS' ? 'SUCCESS' : ('FAILED' as TransferState),
      transaction: row,
      ...(row.status === 'FAILED' ? { failureReason: row.failureReason ?? 'SERVER_ERROR', retryable: false } : {}),
    };
    const cp = row.counterparty;
    const restored: Attempt =
      method !== undefined
        ? { ...common, kind: 'TOP_UP', method }
        : merchant !== undefined
        ? { ...common, kind: 'QR_PAYMENT', merchant, category: row.category }
        : {
            ...common,
            kind: 'TRANSFER',
            recipient: { userId: cp.id, name: cp.name, phone: cp.phone ?? '' },
            ...(row.note !== undefined ? { note: row.note } : {}),
          };
    this.attempts.set(id, restored);
    return restored;
  }

  private async run(attempt: Attempt, work: () => Promise<TransferResult>): Promise<TransferResult> {
    const running = work().finally(() => {
      attempt.running = undefined;
    });
    attempt.running = running;
    return running;
  }

  private move(attempt: Attempt, event: TransferEvent): void {
    attempt.state = transition(attempt.state, event); // NFR-MONEY-04: only §3.2's transitions
  }

  private async dropPlaceholder(attempt: Attempt): Promise<void> {
    const row = await this.deps.cache.getByIdempotencyKey(attempt.key);
    if (row?.id.startsWith(PLACEHOLDER_PREFIX)) {
      await this.deps.cache.delete(row.id);
      const held = heldDelta(attempt);
      await this.adjustWallet([-held[0], -held[1]]);
    }
  }

  private async adjustWallet([balance, usedToday]: WalletDelta): Promise<void> {
    if (balance !== 0 || usedToday !== 0) await this.deps.cache.adjustWallet(balance, usedToday);
  }

  private async cachedBalance(): Promise<number | undefined> {
    return (await this.deps.cache.getWallet())?.wallet.balance;
  }

  private result(attempt: Attempt, auth: TransferAuthOutcome): TransferResult {
    return {
      id: attempt.key,
      state: attempt.state,
      auth,
      ...(attempt.transaction !== undefined && attempt.state !== 'DRAFT' ? { transaction: attempt.transaction } : {}),
      ...(attempt.state === 'FAILED' ? { failureReason: attempt.failureReason, retryable: attempt.retryable ?? false } : {}),
    };
  }
}

const NO_CHANGE: WalletDelta = [0, 0];

/**
 * What the server counts while the attempt is PENDING: a held transfer or QR payment is already out of the
 * balance and in today's total; a pending top-up isn't in the balance yet (ADR-0015 §3).
 */
function heldDelta(attempt: Attempt): WalletDelta {
  return attempt.kind === 'TOP_UP' ? NO_CHANGE : [-attempt.amount, attempt.amount];
}

/** What a SUCCESS changes in all. A top-up never counts toward the daily limit. */
function settledDelta(attempt: Attempt): WalletDelta {
  return attempt.kind === 'TOP_UP' ? [attempt.amount, 0] : [-attempt.amount, attempt.amount];
}

/** RFC 4122 version 4 from 16 random bytes, lowercase. */
export function uuidV4(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new CoreError('INVALID_ARGUMENT', 'uuidV4 needs 16 bytes');
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
