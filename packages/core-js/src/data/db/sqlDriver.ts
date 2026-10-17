import { CoreError } from '@pocketly/core-contract';
import type { SqlQuery } from './sql.generated';

/**
 * The JS core's view of a SQLite database (ADR-0009). Implementations:
 *  - opSqliteDriver (the app: op-sqlite, bundled SQLite, JSI)
 *  - testing/nodeSqliteDriver (Jest and scripts: Node's built-in node:sqlite)
 * Kotlin uses SQLDelight's drivers on the same .sq files.
 */
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;
export interface SqlCommand {
  sql: string;
  values: readonly SqlValue[];
}

export interface SqlDriver {
  /** DDL / pragmas. */
  exec(sql: string): Promise<void>;
  query(sql: string, values: readonly SqlValue[]): Promise<SqlRow[]>;
  /** Returns rows affected. */
  run(sql: string, values: readonly SqlValue[]): Promise<number>;
  /** The same statement for many value lists, in one transaction. Returns total rows affected. */
  runMany(sql: string, rows: readonly (readonly SqlValue[])[]): Promise<number>;
  /** Different statements in one transaction: all of them apply, or none (Kotlin: `db.transaction {}`). */
  batch(commands: readonly SqlCommand[]): Promise<void>;
  close(): Promise<void>;
}

/** Binds a generated query's parameters: named (object) or positional (array). */
export function bind(query: SqlQuery, params: Readonly<Record<string, SqlValue>> | readonly SqlValue[]): SqlValue[] {
  if (Array.isArray(query.params)) {
    const named = params as Readonly<Record<string, SqlValue>>;
    return (query.params as readonly string[]).map((name) => {
      if (!(name in named)) throw new CoreError('INVALID_ARGUMENT', `missing SQL parameter :${name}`);
      return named[name];
    });
  }
  const values = params as readonly SqlValue[];
  if (values.length !== query.params) {
    throw new CoreError('INVALID_ARGUMENT', `expected ${query.params} SQL parameters, got ${values.length}`);
  }
  return [...values];
}

/**
 * Like SQLDelight's driver: a new database (PRAGMA user_version 0) gets the current schema; an
 * older one runs `<n>.sqm` for each version n it's behind. Each step is one transaction.
 */
export async function migrate(
  driver: SqlDriver,
  schema: readonly string[],
  version = 1,
  migrations: Readonly<Record<number, readonly string[]>> = {},
): Promise<void> {
  const [row] = await driver.query('PRAGMA user_version', []);
  const current = Number(row?.user_version ?? 0);
  if (current === 0) {
    await inTransaction(driver, schema, version);
    return;
  }
  for (let from = current; from < version; from++) {
    const steps = migrations[from];
    if (steps === undefined) throw new CoreError('SERVER_ERROR', `no migration from schema version ${from}`);
    await inTransaction(driver, steps, from + 1);
  }
}

function inTransaction(driver: SqlDriver, statements: readonly string[], version: number): Promise<void> {
  return driver.batch([...statements, `PRAGMA user_version = ${version}`].map((sql) => ({ sql, values: [] })));
}
