package com.pocketly.shared.sync

import com.pocketly.shared.data.CacheStore
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.currentTimeMillis

/**
 * Delta sync of the local replica (ADR-0009): pulls server changes after the stored token,
 * page by page, upserting each page and advancing the token as it goes (a failure mid-way
 * keeps what was already applied). Mirrors packages/core-js/src/sync/ledgerSync.ts.
 */
internal class LedgerSync(private val api: WalletApi, private val cache: CacheStore) {
    suspend fun sync() {
        var token = cache.syncToken()
        while (true) {
            val page = api.getChanges(token, PAGE_SIZE)
            if (page.items.isNotEmpty()) cache.upsertMany(page.items)
            token = page.nextToken
            cache.markSynced(token, currentTimeMillis())
            if (!page.hasMore) return
        }
    }

    companion object {
        /** Changes per request. The server caps at 500. */
        const val PAGE_SIZE = 500
    }
}
