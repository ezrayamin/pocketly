import type { CacheStore } from '../data/cacheStore';
import type { WalletApi } from '../data/walletApi';

/** Changes per request. The server caps at 500. */
export const SYNC_PAGE_SIZE = 500;

/**
 * Delta sync of the local replica (ADR-0009): pulls server changes after the stored token,
 * page by page, upserting each page and advancing the token as it goes (a failure mid-way
 * keeps what was already applied). If the replica is cleared meanwhile (logout), it stops
 * without writing. Mirrors shared/.../sync/LedgerSync.kt.
 */
export class LedgerSync {
  constructor(
    private readonly api: WalletApi,
    private readonly cache: CacheStore,
  ) {}

  async sync(): Promise<void> {
    const generation = this.cache.generation;
    // Checked right before each write: a clear() queues its deletes after any write already
    // started, so only writes that begin after it need stopping.
    const cleared = () => this.cache.generation !== generation;
    let token = await this.cache.syncToken();
    for (;;) {
      const page = await this.api.getChanges(token, SYNC_PAGE_SIZE);
      if (cleared()) return;
      if (page.items.length > 0) await this.cache.upsertMany(page.items);
      if (cleared()) return;
      token = page.nextToken;
      await this.cache.markSynced(token, Date.now());
      if (!page.hasMore) return;
    }
  }
}
