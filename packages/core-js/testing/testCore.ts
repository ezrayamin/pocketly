import type { DatasetConfig } from '@pocketly/core-contract';
import { JsCore } from '../src/jsCore';
import { MemorySecureStore } from '../src/security/secureStore';
import { nodePinCrypto } from './nodePinCrypto';
import { nodeSqliteDriver } from './nodeSqliteDriver';

/** A JsCore on in-memory (or file) node:sqlite databases, for tests and scripts. */
export function testCore(
  options: {
    dataset?: DatasetConfig;
    serverPath?: string;
    cachePath?: string;
    secure?: MemorySecureStore;
    clock?: () => number;
    pinIterations?: number;
  } = {},
): JsCore {
  return new JsCore({
    server: nodeSqliteDriver(options.serverPath),
    cache: nodeSqliteDriver(options.cachePath),
    dataset: options.dataset,
    secure: options.secure ?? new MemorySecureStore(),
    crypto: nodePinCrypto,
    clock: options.clock,
    pinIterations: options.pinIterations,
  });
}
