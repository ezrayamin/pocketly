import { open, type PreparedStatement } from '@op-engineering/op-sqlite';
import type { SqlDriver, SqlRow, SqlValue } from './sqlDriver';

/** The app's driver: op-sqlite (JSI, bundled SQLite). One file per database (ADR-0009). */
export function opSqliteDriver(name: string): SqlDriver {
  const db = open({ name });
  // Kept for the connection's lifetime, like SQLDelight's statement cache on the Kotlin side.
  const statements = new Map<string, PreparedStatement>();
  const prepared = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepareStatement(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  return {
    async exec(sql) {
      await db.execute(sql);
    },
    async query(sql, values) {
      return (await db.execute(sql, values as SqlValue[])).rows as SqlRow[];
    },
    async run(sql, values) {
      return (await db.execute(sql, values as SqlValue[])).rowsAffected;
    },
    // executeBatch would also use one transaction, but it prepares the statement again for
    // every row. Here one prepared statement is bound and stepped per row, as SQLDelight does.
    // transaction() takes op-sqlite's queue lock and rolls back on error; the loop runs
    // synchronously on the JS thread.
    async runMany(sql, rows) {
      if (rows.length === 0) return 0;
      let rowsAffected = 0;
      await db.transaction(async () => {
        const statement = prepared(sql);
        for (const values of rows) {
          statement.bindSync(values as SqlValue[]);
          rowsAffected += statement.executeSync().rowsAffected;
        }
      });
      return rowsAffected;
    },
    async close() {
      statements.clear();
      db.close();
    },
  };
}
