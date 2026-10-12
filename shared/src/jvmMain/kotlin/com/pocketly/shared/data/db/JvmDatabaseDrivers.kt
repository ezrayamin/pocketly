package com.pocketly.shared.data.db

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pocketly.shared.db.cache.CacheDatabase
import com.pocketly.shared.db.server.ServerDatabase
import java.util.Properties

/** JDBC SQLite for JVM tests. In memory by default; pass paths to test persistence. */
class JvmDatabaseDrivers(private val serverPath: String? = null, private val cachePath: String? = null) : DatabaseDrivers {
    override fun server() = JdbcSqliteDriver(url(serverPath), Properties(), ServerDatabase.Schema)
    override fun cache() = JdbcSqliteDriver(url(cachePath), Properties(), CacheDatabase.Schema)

    private fun url(path: String?) = if (path == null) JdbcSqliteDriver.IN_MEMORY else "jdbc:sqlite:$path"
}
