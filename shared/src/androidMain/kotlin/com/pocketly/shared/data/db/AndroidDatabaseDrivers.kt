package com.pocketly.shared.data.db

import android.content.Context
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pocketly.shared.db.cache.CacheDatabase
import com.pocketly.shared.db.server.ServerDatabase

/** android.database.sqlite, the platform SQLite (ADR-0009). */
class AndroidDatabaseDrivers(private val context: Context) : DatabaseDrivers {
    override fun server() = AndroidSqliteDriver(ServerDatabase.Schema, context, DatabaseDrivers.SERVER_FILE)
    override fun cache() = AndroidSqliteDriver(CacheDatabase.Schema, context, DatabaseDrivers.CACHE_FILE)
}
