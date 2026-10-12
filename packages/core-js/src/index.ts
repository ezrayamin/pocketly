import { LIVE_DATASET } from '@pocketly/core-contract';
import type { Core } from '@pocketly/core-contract';
import { opSqliteDriver } from './data/db/opSqliteDriver';
import { createJsCore } from './jsCore';
import { quickCryptoPinCrypto } from './security/quickCryptoPinCrypto';
import { sensitiveInfoStore } from './security/sensitiveInfoStore';

export { JsCore, createJsCore } from './jsCore';
export type { JsCoreOptions } from './jsCore';
export type { SqlDriver } from './data/db/sqlDriver';
export type { SecureStore } from './security/secureStore';
export type { PinCrypto } from './security/pinCrypto';
export { generateTransactions } from './data/seedData';
export { PriceFeed } from './sync/priceFeed';
export { nextTransferState, transition, InvalidTransitionError } from './domain/transferStateMachine';

/** Entry point used by `apps/mobile/src/core.ts` when CORE_IMPL=js. Two files (ADR-0009). */
export function createCore(): Core {
  return createJsCore({
    server: opSqliteDriver('pocketly-server.db'),
    cache: opSqliteDriver('pocketly-cache.db'),
    dataset: LIVE_DATASET,
    secure: sensitiveInfoStore(),
    crypto: quickCryptoPinCrypto(),
  });
}
