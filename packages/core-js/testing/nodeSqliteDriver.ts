import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { SqlDriver, SqlRow, SqlValue } from '../src/data/db/sqlDriver';

/** Node's built-in SQLite, for Jest and scripts. `:memory:` by default. Not bundled into the app. */
export function nodeSqliteDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);
  const statements = new Map<string, StatementSync>();
  const prepared = (sql: string) => {
    let s = statements.get(sql);
    if (!s) {
      s = db.prepare(sql);
      statements.set(sql, s);
    }
    return s;
  };
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async query(sql, values) {
      return prepared(sql).all(...(values as SqlValue[])) as SqlRow[];
    },
    async run(sql, values) {
      return Number(prepared(sql).run(...(values as SqlValue[])).changes);
    },
    async runMany(sql, rows) {
      const s = prepared(sql);
      db.exec('BEGIN');
      try {
        let changed = 0;
        for (const values of rows) changed += Number(s.run(...(values as SqlValue[])).changes);
        db.exec('COMMIT');
        return changed;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async batch(commands) {
      db.exec('BEGIN');
      try {
        for (const c of commands) prepared(c.sql).run(...(c.values as SqlValue[]));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
}
