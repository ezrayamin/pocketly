package com.pocketly.shared.data.db

import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.pocketly.shared.db.cache.CacheDatabase
import com.pocketly.shared.db.server.ServerDatabase

/** The system libsqlite3 (ADR-0009). */
class IosDatabaseDrivers : DatabaseDrivers {
    override fun server() = NativeSqliteDriver(ServerDatabase.Schema, DatabaseDrivers.SERVER_FILE)
    override fun cache() = NativeSqliteDriver(CacheDatabase.Schema, DatabaseDrivers.CACHE_FILE)
}
