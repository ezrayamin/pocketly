import { LIVE_DATASET } from '@pocketly/core-contract';
import type { Core } from '@pocketly/core-contract';
import { createJsCore } from './jsCore';

export { JsCore, createJsCore } from './jsCore';
export type { JsCoreOptions } from './jsCore';
export { generateTransactions } from './data/seedData';
export { PriceFeed } from './sync/priceFeed';
export { nextTransferState, transition, InvalidTransitionError } from './domain/transferStateMachine';

/** Entry point used by `apps/mobile/src/core.ts` when CORE_IMPL=js. */
export function createCore(): Core {
  return createJsCore({ dataset: LIVE_DATASET });
}
