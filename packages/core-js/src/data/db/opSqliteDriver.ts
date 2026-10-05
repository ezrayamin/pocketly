import { open } from '@op-engineering/op-sqlite';
import type { SqlDriver, SqlRow, SqlValue } from './sqlDriver';

/** The app's driver: op-sqlite (JSI, bundled SQLite). One file per database (ADR-0009). */
export function opSqliteDriver(name: string): SqlDriver {
  const db = open({ name });
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
    async runMany(sql, rows) {
      if (rows.length === 0) return 0;
      const result = await db.executeBatch(rows.map((values) => [sql, values as SqlValue[]]));
      return result.rowsAffected ?? 0;
    },
    async close() {
      db.close();
    },
  };
}
