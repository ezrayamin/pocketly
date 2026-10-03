import { createJsCore } from './jsCore';

export { JsCore, createJsCore } from './jsCore';
export { generateTransactions } from './data/seedData';
export { PriceFeed } from './sync/priceFeed';
export { nextTransferState, transition, InvalidTransitionError } from './domain/transferStateMachine';

/** App-wide singleton, picked by `apps/mobile/src/core.ts` when CORE_IMPL=js. */
export const core = createJsCore();
