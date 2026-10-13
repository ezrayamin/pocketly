import type { DatasetConfig } from '@pocketly/core-contract';
import { JsCore } from '../src/jsCore';
import { MemorySecureStore, type SecureStore } from '../src/security/secureStore';
import { FakeBiometricSigner } from './fakeBiometricSigner';
import { nodePinCrypto } from './nodePinCrypto';
import { nodeSqliteDriver } from './nodeSqliteDriver';

/** A JsCore on in-memory (or file) node:sqlite databases, for tests and scripts. */
export function testCore(
  options: {
    dataset?: DatasetConfig;
    serverPath?: string;
    cachePath?: string;
    secure?: SecureStore;
    clock?: () => number;
    pinIterations?: number;
    biometrics?: FakeBiometricSigner;
  } = {},
): JsCore {
  return new JsCore({
    server: nodeSqliteDriver(options.serverPath),
    cache: nodeSqliteDriver(options.cachePath),
    dataset: options.dataset,
    secure: options.secure ?? new MemorySecureStore(),
    crypto: nodePinCrypto,
    biometrics: options.biometrics ?? new FakeBiometricSigner(),
    clock: options.clock,
    pinIterations: options.pinIterations,
  });
}
