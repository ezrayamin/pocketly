import type { CacheStore } from '../data/cacheStore';
import type { WalletApi } from '../data/walletApi';

/** Changes per request. The server caps at 500. */
export const SYNC_PAGE_SIZE = 500;

/**
 * Delta sync of the local replica (ADR-0009): pulls server changes after the stored token,
 * page by page, upserting each page and advancing the token as it goes (a failure mid-way
 * keeps what was already applied). Mirrors shared/.../sync/LedgerSync.kt.
 */
export class LedgerSync {
  constructor(
    private readonly api: WalletApi,
    private readonly cache: CacheStore,
  ) {}

  async sync(): Promise<void> {
    let token = await this.cache.syncToken();
    for (;;) {
      const page = await this.api.getChanges(token, SYNC_PAGE_SIZE);
      if (page.items.length > 0) await this.cache.upsertMany(page.items);
      token = page.nextToken;
      await this.cache.markSynced(token, Date.now());
      if (!page.hasMore) return;
    }
  }
}
