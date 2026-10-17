import { CoreError, RECENT_CONTACTS_LIMIT, TRANSFER_FEE_MINOR, TRANSFER_MIN_MINOR, toCoreError } from '@pocketly/core-contract';
import type {
  AmountCheck,
  Contact,
  ContactSearch,
  ErrorCode,
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
import { checkTransferAmount, exceededLimit, isRetryable, isValidTransferAmount, normalizeNote } from '../domain/transferPolicy';
import { transition } from '../domain/transferStateMachine';
import type { BiometricAuth } from '../security/biometricAuth';
import type { PinAuth } from '../security/pinAuth';

/** One transfer attempt (FR-TRF-05): one key, one approval. Its id is its idempotency key. */
interface Attempt {
  readonly key: string;
  readonly recipient: Contact;
  readonly amount: number;
  readonly note?: string;
  state: TransferState;
  failureReason?: ErrorCode;
  retryable?: boolean;
  transaction?: Transaction;
  /** The confirm or status check running now: a second call joins it (double tap). */
  running?: Promise<TransferResult>;
}

interface Draft {
  recipient: Contact;
  balance: number;
  dailyRemaining: number;
}

export interface TransferFlowDeps {
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
 * submission, 15 s) → SUCCESS / FAILED / PENDING → status check. Every state change goes
 * through the §3.2 state machine. Mirrors shared/.../sync/TransferFlow.kt.
 */
export class TransferFlow {
  private draft: Draft | undefined;
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly deps: TransferFlowDeps) {}

  /** Logout / resetData: forget the draft and every attempt (the replica is cleared too). */
  reset(): void {
    this.draft = undefined;
    this.attempts.clear();
  }

  async searchContacts(query: string): Promise<ContactSearch> {
    const self = (await this.deps.pin.getAuthState()).phone;
    const directory = await this.deps.api.searchContacts(query);
    const { contacts, phoneLookup } = searchDirectory(query, directory, self);
    const recent =
      query.trim().length === 0
        ? (await this.deps.cache.recentRecipients(RECENT_CONTACTS_LIMIT + 1)).filter((c) => c.phone !== self).slice(0, RECENT_CONTACTS_LIMIT)
        : [];
    return phoneLookup === undefined ? { recent, contacts } : { recent, contacts, phoneLookup };
  }

  async startTransfer(recipientId: string): Promise<TransferDraft> {
    const self = (await this.deps.pin.getAuthState()).phone;
    let recipient: Contact;
    try {
      recipient = await this.deps.api.getContact(recipientId);
    } catch (e) {
      const error = toCoreError(e);
      throw error.code === 'NOT_FOUND' ? new CoreError('RECIPIENT_NOT_FOUND', `No user ${recipientId}`) : error;
    }
    if (recipient.phone === self) throw new CoreError('INVALID_ARGUMENT', 'You can\'t send money to yourself');
    const wallet = await this.deps.fetchWallet(); // FR-TRF-11: fresh, or no transfer
    const draft = { recipient, balance: wallet.balance, dailyRemaining: Math.max(0, wallet.dailyLimit - wallet.usedToday) };
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
    if (!isValidTransferAmount(amount)) throw new CoreError('INVALID_ARGUMENT', 'Invalid transfer amount');
    const over = exceededLimit(amount, draft);
    if (over !== undefined) throw new CoreError(over, 'Amount is over the limit');
    const normalized = normalizeNote(note);
    // Attempts never sent go: a new review is a new attempt (ADR-0014 §2).
    for (const [id, a] of this.attempts) if (a.state === 'DRAFT' && a.running === undefined) this.attempts.delete(id);
    const key = uuidV4(this.deps.randomBytes(16));
    this.attempts.set(key, { key, recipient: draft.recipient, amount, note: normalized, state: 'DRAFT' });
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

  async confirmTransfer(id: string, auth?: TransferAuth): Promise<TransferResult> {
    const attempt = await this.attempt(id);
    if (attempt.running) return attempt.running;
    if (attempt.state === 'DRAFT' && auth === undefined) {
      throw new CoreError('INVALID_ARGUMENT', 'A new transfer needs biometrics or the PIN');
    }
    if (attempt.state !== 'DRAFT' && !(attempt.state === 'FAILED' && attempt.retryable)) {
      return this.result(attempt, 'NOT_REQUIRED');
    }
    return this.run(attempt, () => (attempt.state === 'DRAFT' ? this.authorizeAndSend(attempt, auth!) : this.retry(attempt)));
  }

  async getTransferStatus(id: string): Promise<TransferResult> {
    const attempt = await this.attempt(id);
    if (attempt.running) return attempt.running;
    if (attempt.state !== 'PENDING') return this.result(attempt, 'NOT_REQUIRED');
    return this.run(attempt, () => this.checkStatus(attempt));
  }

  // ── steps ────────────────────────────────────────────────────────────

  private async authorizeAndSend(attempt: Attempt, auth: TransferAuth): Promise<TransferResult> {
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

  private async authorize(
    attempt: Attempt,
    auth: TransferAuth,
  ): Promise<{ outcome: TransferAuthOutcome; extra: Pick<TransferResult, 'attemptsLeft' | 'lockedUntil'> }> {
    if (auth.method === 'BIOMETRIC') {
      if (auth.prompt === undefined) throw new CoreError('INVALID_ARGUMENT', 'BIOMETRIC needs a prompt');
      const outcome = await this.deps.biometric.approveTransfer(
        { amount: attempt.amount, recipientId: attempt.recipient.userId, idempotencyKey: attempt.key },
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
    const request = { recipientId: attempt.recipient.userId, amount: attempt.amount, ...(attempt.note !== undefined ? { note: attempt.note } : {}) };
    let tx: Transaction;
    try {
      tx = await this.deps.api.transfer(request, attempt.key);
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
    const now = this.deps.clock();
    const placeholder: Transaction = {
      id: `${PLACEHOLDER_PREFIX}${attempt.key}`,
      idempotencyKey: attempt.key,
      type: 'TRANSFER_OUT',
      category: 'TRANSFER',
      amount: attempt.amount,
      counterparty: { kind: 'USER', id: attempt.recipient.userId, name: attempt.recipient.name, phone: attempt.recipient.phone },
      ...(attempt.note !== undefined ? { note: attempt.note } : {}),
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    if ((await this.deps.cache.getByIdempotencyKey(attempt.key)) === undefined) {
      await this.deps.cache.upsert(placeholder);
      await this.deps.cache.adjustWallet(-attempt.amount, attempt.amount); // the server holds it too
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
    if (tx.status === 'SUCCESS') {
      this.move(attempt, ok);
      if (!wasHeld) await this.deps.cache.adjustWallet(-attempt.amount, attempt.amount);
    } else {
      this.move(attempt, failed);
      attempt.failureReason = tx.failureReason ?? 'SERVER_ERROR';
      attempt.retryable = false; // the server recorded it: the same key returns this again
      if (wasHeld) await this.deps.cache.adjustWallet(attempt.amount, -attempt.amount); // released
    }
    return { ...this.result(attempt, auth), balance: await this.cachedBalance() };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private currentDraft(): Draft {
    if (this.draft === undefined) throw new CoreError('NOT_FOUND', 'No transfer started');
    return this.draft;
  }

  /** In memory, or a pending one rebuilt from the replica after a restart (NFR-REL-03). */
  private async attempt(id: string): Promise<Attempt> {
    const known = this.attempts.get(id);
    if (known) return known;
    const row = await this.deps.cache.getByIdempotencyKey(id);
    if (row === undefined || row.type !== 'TRANSFER_OUT' || row.counterparty === undefined) {
      throw new CoreError('NOT_FOUND', `No transfer ${id}`);
    }
    const restored: Attempt = {
      key: id,
      recipient: { userId: row.counterparty.id, name: row.counterparty.name, phone: row.counterparty.phone ?? '' },
      amount: row.amount,
      ...(row.note !== undefined ? { note: row.note } : {}),
      state: row.status === 'PENDING' ? 'PENDING' : row.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      transaction: row,
      ...(row.status === 'FAILED' ? { failureReason: row.failureReason ?? 'SERVER_ERROR', retryable: false } : {}),
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
      await this.deps.cache.adjustWallet(attempt.amount, -attempt.amount);
    }
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

/** RFC 4122 version 4 from 16 random bytes, lowercase. */
export function uuidV4(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new CoreError('INVALID_ARGUMENT', 'uuidV4 needs 16 bytes');
  const b = Uint8Array.from(bytes);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
