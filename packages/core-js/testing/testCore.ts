import type { DatasetConfig } from '@pocketly/core-contract';
import { JsCore } from '../src/jsCore';
import { nodeSqliteDriver } from './nodeSqliteDriver';

/** A JsCore on in-memory (or file) node:sqlite databases, for tests and scripts. */
export function testCore(options: { dataset?: DatasetConfig; serverPath?: string; cachePath?: string } = {}): JsCore {
  return new JsCore({
    server: nodeSqliteDriver(options.serverPath),
    cache: nodeSqliteDriver(options.cachePath),
    dataset: options.dataset,
  });
}
