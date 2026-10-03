import type { TransferEvent, TransferState } from '@pocketly/core-contract';
import fixture from '@pocketly/core-contract/fixtures/state-machine.json';
import { InvalidTransitionError, nextTransferState, transition } from '../src/domain/transferStateMachine';

const allowed = new Map(fixture.transitions.map((t) => [`${t.from}:${t.event}`, t.to]));

describe('transfer state machine (NFR-TEST-03)', () => {
  // Exhaustive: every state × every event.
  for (const from of fixture.states as TransferState[]) {
    for (const event of fixture.events as TransferEvent[]) {
      const expected = allowed.get(`${from}:${event}`);
      it(`${from} --${event}--> ${expected ?? 'invalid'}`, () => {
        expect(nextTransferState(from, event)).toBe(expected);
        if (expected === undefined) {
          expect(() => transition(from, event)).toThrow(InvalidTransitionError);
        } else {
          expect(transition(from, event)).toBe(expected);
        }
      });
    }
  }
});
