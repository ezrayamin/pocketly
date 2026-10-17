import { CoreError } from '@pocketly/core-contract';
import type { Contact, OtpSendResult, Transaction, Wallet } from '@pocketly/core-contract';
import type { ChangesPage, ServerOtpVerify, TransferRequest, WalletApi } from './walletApi';

/** Reads give up after readTimeoutMs; a transfer submission after writeTimeoutMs (FR-TRF-09). */
export type CallKind = 'read' | 'write';

/**
 * NFR-REL-01: every backend call has a timeout. Wraps any WalletApi (fake or real).
 *
 * ADR-0007: after the timeout, the call is abandoned, not cancelled. A real server keeps
 * working after the client gives up, so the request may still complete (and its effects,
 * e.g. a transfer, still happen server-side). What the client guarantees is that the late
 * response is discarded: the caller already got NETWORK_TIMEOUT and nothing else is updated.
 * Retries with backoff come with the real backend. Mirrors shared/.../data/TimeoutWalletApi.kt.
 */
export class TimeoutWalletApi implements WalletApi {
  constructor(
    private readonly inner: WalletApi,
    private readonly timeoutMs: (kind: CallKind) => number,
  ) {}

  getWallet(): Promise<Wallet> {
    return this.withTimeout(() => this.inner.getWallet());
  }

  getChanges(afterToken: string | undefined, limit: number): Promise<ChangesPage> {
    return this.withTimeout(() => this.inner.getChanges(afterToken, limit));
  }

  getTransaction(id: string): Promise<Transaction> {
    return this.withTimeout(() => this.inner.getTransaction(id));
  }

  requestOtp(phone: string): Promise<OtpSendResult> {
    return this.withTimeout(() => this.inner.requestOtp(phone));
  }

  verifyOtp(phone: string, code: string): Promise<ServerOtpVerify> {
    return this.withTimeout(() => this.inner.verifyOtp(phone, code));
  }

  searchContacts(query: string): Promise<Contact[]> {
    return this.withTimeout(() => this.inner.searchContacts(query));
  }

  getContact(userId: string): Promise<Contact> {
    return this.withTimeout(() => this.inner.getContact(userId));
  }

  /** A timeout here doesn't mean "not applied": the caller treats it as PENDING (ADR-0014 §4). */
  transfer(request: TransferRequest, idempotencyKey: string): Promise<Transaction> {
    return this.withTimeout(() => this.inner.transfer(request, idempotencyKey), 'write');
  }

  getTransferByKey(idempotencyKey: string): Promise<Transaction> {
    return this.withTimeout(() => this.inner.getTransferByKey(idempotencyKey));
  }

  private withTimeout<T>(call: () => Promise<T>, kind: CallKind = 'read'): Promise<T> {
    const timeoutMs = this.timeoutMs(kind);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new CoreError('NETWORK_TIMEOUT', `No response after ${timeoutMs} ms`));
      }, timeoutMs);
      call().then(
        (value) => {
          if (settled) return; // late response: discarded (ADR-0007)
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return; // late failure: discarded too, never an unhandled rejection
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
