import type { TransferEvent, TransferState } from '@pocketly/core-contract';

/**
 * requirements §3.2. The only place allowed transitions are defined (NFR-MONEY-04).
 * Mirrors shared/.../domain/TransferStateMachine.kt.
 */
const TRANSITIONS: Readonly<Record<TransferState, Partial<Record<TransferEvent, TransferState>>>> = {
  DRAFT: { CONFIRM: 'AUTHORIZING' },
  AUTHORIZING: { CANCEL: 'DRAFT', AUTH_OK: 'SUBMITTING' },
  SUBMITTING: { SUBMIT_OK: 'SUCCESS', SUBMIT_ERROR: 'FAILED', TIMEOUT: 'PENDING' },
  FAILED: { RETRY: 'SUBMITTING' },
  PENDING: { STATUS_SUCCESS: 'SUCCESS', STATUS_FAILED: 'FAILED' },
  SUCCESS: { SERVER_REVERSAL: 'REVERSED' },
  REVERSED: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TransferState,
    readonly event: TransferEvent,
  ) {
    super(`Invalid transfer transition: ${from} --${event}-->`);
    this.name = 'InvalidTransitionError';
  }
}

/** Returns the next state, or `undefined` if the transition isn't allowed. */
export function nextTransferState(from: TransferState, event: TransferEvent): TransferState | undefined {
  return TRANSITIONS[from][event];
}

export function transition(from: TransferState, event: TransferEvent): TransferState {
  const to = nextTransferState(from, event);
  if (to === undefined) {
    throw new InvalidTransitionError(from, event);
  }
  return to;
}
