package com.pocketly.shared.data.db

import app.cash.sqldelight.db.SqlDriver

/**
 * Opens the two databases (ADR-0009): the fake server's and the app's replica, as separate
 * files. Platform implementations use the system SQLite:
 *  - Android: [AndroidDatabaseDrivers] · iOS: [IosDatabaseDrivers] · JVM tests: [JvmDatabaseDrivers]
 */
interface DatabaseDrivers {
    fun server(): SqlDriver
    fun cache(): SqlDriver

    companion object {
        const val SERVER_FILE = "pocketly-server.db"
        const val CACHE_FILE = "pocketly-cache.db"
    }
}
