import { NOTIFICATIONS_KEPT } from '@pocketly/core-contract';
import type { AppNotification, Subscription, Transaction } from '@pocketly/core-contract';
import type { CacheStore } from '../data/cacheStore';
import type { WalletApi, WalletEvent } from '../data/walletApi';

/** Events per request. The server caps at 500. */
export const EVENTS_PAGE_SIZE = 100;

/**
 * ADR-0017 §2: reads the server's event log after the last event applied, page by page, and applies
 * each event once: the transaction into the replica, a notification if it notifies, the cursor, in one
 * cache transaction. Catch-ups run one at a time; asking while one runs gets one more pass after it
 * (the signal may be for an event that pass already missed). A clear() meanwhile (logout) stops it
 * without writing. Mirrors shared/.../sync/EventSync.kt.
 */
export class EventSync {
  private readonly listeners = new Set<(notifications: AppNotification[]) => void>();
  private last: Promise<void> = Promise.resolve();
  private queued: Promise<void> | undefined;

  constructor(
    private readonly api: WalletApi,
    private readonly cache: CacheStore,
    /** A settled payment this install saw PENDING: its attempt moves (PaymentFlow.applySettled). */
    private readonly onSettled: (tx: Transaction) => Promise<void>,
  ) {}

  /** Delivery only: catching up goes on with no one subscribed. */
  subscribe(onNew: (notifications: AppNotification[]) => void): Subscription {
    this.listeners.add(onNew);
    return { unsubscribe: () => void this.listeners.delete(onNew) };
  }

  catchUp(): Promise<void> {
    if (this.queued) return this.queued;
    const next = this.last
      .catch(() => undefined)
      .then(() => {
        this.queued = undefined;
        return this.pass();
      });
    this.queued = next;
    this.last = next;
    return next;
  }

  private async pass(): Promise<void> {
    const generation = this.cache.generation;
    const cleared = () => this.cache.generation !== generation;
    const added: AppNotification[] = [];
    try {
      let cursor = await this.cache.eventCursor();
      for (;;) {
        const page = await this.api.getEvents(cursor, EVENTS_PAGE_SIZE);
        for (const event of page.items) {
          if (event.seq <= cursor) continue; // delivered twice: applied once
          if (cleared()) return;
          const notification = await this.apply(event, cleared);
          if (notification === null) return;
          if (notification) added.unshift(notification);
          cursor = event.seq;
        }
        if (!page.hasMore) return;
      }
    } finally {
      // What was applied is delivered, even when a later page failed.
      if (added.length > 0 && !cleared()) for (const listener of this.listeners) listener(added);
    }
  }

  /** The notification it made, undefined for none, null if the replica was cleared meanwhile. */
  private async apply(event: WalletEvent, cleared: () => boolean): Promise<AppNotification | undefined | null> {
    const tx = event.transaction;
    // The server's row, or the app's own pending one for the same key (ADR-0014 §4).
    const before = (await this.cache.get(tx.id)) ?? (await this.cache.getByIdempotencyKey(tx.idempotencyKey));
    const notifies = event.kind === 'MONEY_RECEIVED' || before?.status === 'PENDING';
    if (event.kind === 'TRANSACTION_SETTLED' && before?.status === 'PENDING') await this.onSettled(tx);
    if (cleared()) return null;
    const id = `evt-${event.seq}`;
    const notification = notifies ? { id, kind: event.kind, createdAt: event.createdAt } : undefined;
    await this.cache.applyEvent(event.seq, tx, notification, NOTIFICATIONS_KEPT);
    // Money in that the replica didn't have: the balance moves with the history (NFR-MONEY-03).
    if (event.kind === 'MONEY_RECEIVED' && before === undefined && !cleared())
      await this.cache.adjustWallet(tx.amount, 0);
    return notification && { ...notification, transaction: tx, read: false };
  }
}
