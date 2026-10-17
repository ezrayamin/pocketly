/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LIVE_DATASET, NETWORK_NORMAL } from '@pocketly/core-contract';
import { verifyTestPhone } from '@pocketly/core-contract/src/testing/onboarding';
import App from '../App';
import { core } from '../src/core';
import { amountMessage, canOfferMax, resultCopy } from '../src/features/send/sendCopy';

/** Slice 6 (F5): the Send flow through the real jsCore, Home → recipient → amount → review → PIN → result. */
const PIN = '482915';
jest.setTimeout(20_000); // each flow hashes the PIN (600,000 PBKDF2 iterations)
type Tree = ReactTestRenderer.ReactTestRenderer;

async function launch(): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App launchArgs={{ skipLock: 'true' }} />);
  });
  return tree;
}

function has(tree: Tree, testID: string): boolean {
  return tree.root.findAll((n) => n.props.testID === testID).length > 0;
}

function text(tree: Tree, testID: string): string {
  const node = tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string')[0];
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c);
}

/** Waits for async core work (PIN hashing, fake latency) to land in the tree. */
async function until(tree: Tree, condition: () => boolean, timeoutMs = 5_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the UI');
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function press(tree: Tree, testID: string) {
  await until(tree, () => has(tree, testID));
  await ReactTestRenderer.act(async () => {
    tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0].props.onPress();
  });
}

async function typeAmount(tree: Tree, keys: string) {
  for (const k of keys) await press(tree, `amount-key-${k === '.' ? 'dot' : k}`);
}

async function enterPin(tree: Tree, pin: string) {
  for (const digit of pin) await press(tree, `pin-key-${digit}`);
}

/** Home → Send → Andi → amount → review. */
async function toReview(tree: Tree, amount = '150') {
  await press(tree, 'quick-send');
  await press(tree, 'contact-u-01');
  await until(tree, () => has(tree, 'send-amount'));
  await typeAmount(tree, amount);
  await press(tree, 'amount-review');
  await until(tree, () => has(tree, 'send-review'));
}

// Once per file: the fake OTP server refuses a second code within 30 s (FR-AUTH-02).
beforeAll(async () => {
  await core.resetAuth();
  await verifyTestPhone(core);
  await core.setPin(PIN);
});

beforeEach(async () => {
  core.setNetworkSimulation(NETWORK_NORMAL);
  await core.resetData(LIVE_DATASET);
});

afterEach(() => core.setNetworkSimulation(NETWORK_NORMAL));

describe('Send flow (F5, jsCore)', () => {
  it('sends with the PIN, shows Sent, and Home shows the new balance (FR-TRF-03/04/07)', async () => {
    const tree = await launch();
    await toReview(tree, '150');
    expect(text(tree, 'review-amount')).toBe('$150.00');
    expect(text(tree, 'review-fee')).toBe('Free');
    expect(text(tree, 'review-balance-after')).toBe('$14,440.85');

    await press(tree, 'review-confirm'); // biometrics are off: straight to the PIN
    await until(tree, () => has(tree, 'send-pin'));
    await enterPin(tree, PIN);
    await until(tree, () => has(tree, 'send-result-success'));
    expect(text(tree, 'result-title')).toBe('Sent');
    expect(text(tree, 'result-tx-id')).toBe('trf-1');
    expect(text(tree, 'result-balance')).toBe('$14,440.85');

    await press(tree, 'result-done');
    await until(tree, () => has(tree, 'balance') && text(tree, 'balance') === '$14,440.85');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('a wrong PIN sends nothing; Cancel goes back to review (FR-TRF-04)', async () => {
    const tree = await launch();
    await toReview(tree, '20');
    await press(tree, 'review-confirm');
    await enterPin(tree, '159260');
    await until(
      tree,
      () =>
        tree.root.findAll((n) => typeof n.props.children === 'string' && n.props.children.startsWith('Wrong PIN'))
          .length > 0,
    );
    await press(tree, 'send-pin-cancel');
    await until(tree, () => has(tree, 'send-review') && !has(tree, 'send-pin'));
    expect((await core.getWallet()).balance).toBe(1_459_085);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it("the keypad drops what can't be an amount, and offers the most it can send (FR-TRF-02/10)", async () => {
    const tree = await launch();
    await press(tree, 'quick-send');
    await press(tree, 'contact-u-02');
    await until(tree, () => has(tree, 'send-amount'));
    await typeAmount(tree, '0');
    await typeAmount(tree, '0'); // "00" is no amount: dropped
    expect(text(tree, 'amount-display')).toBe('$0');
    await press(tree, 'amount-key-erase');
    await typeAmount(tree, '12.345'); // the third decimal is dropped
    expect(text(tree, 'amount-display')).toBe('$12.34');
    expect(text(tree, 'amount-remaining')).toBe('Balance after: $14,578.51');

    for (let i = 0; i < 5; i++) await press(tree, 'amount-key-erase');
    await typeAmount(tree, '9999');
    expect(text(tree, 'amount-error')).toBeDefined();
    await press(tree, 'amount-send-max');
    await until(tree, () => !has(tree, 'amount-error'));
    const review = tree.root.findAll(
      (n) => n.props.testID === 'amount-review' && n.props.accessibilityState !== undefined,
    )[0];
    expect(review.props.accessibilityState.disabled).toBe(false);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('a server error offers Retry with the same key; it then goes through once (FR-TRF-08)', async () => {
    const tree = await launch();
    await toReview(tree, '30');
    core.setNetworkSimulation({ mode: 'ALWAYS_FAIL', failureRatePercent: 0 });
    await press(tree, 'review-confirm');
    await enterPin(tree, PIN);
    await until(tree, () => has(tree, 'send-result-failed'));
    expect(text(tree, 'result-title')).toBe("Transfer didn't go through");
    expect(text(tree, 'result-message')).toBe('Something went wrong on our side. Please try again.');

    core.setNetworkSimulation(NETWORK_NORMAL);
    await press(tree, 'result-retry');
    await until(tree, () => has(tree, 'send-result-success'));
    expect((await core.getWallet()).balance).toBe(1_459_085 - 3_000);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('no answer within 15 s (here 100 ms) is Still processing (FR-TRF-09)', async () => {
    const tree = await launch();
    await toReview(tree, '40');
    core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100, readTimeoutMs: 100 });
    await press(tree, 'review-confirm');
    await enterPin(tree, PIN);
    await until(tree, () => has(tree, 'send-result-pending'));
    expect(text(tree, 'result-title')).toBe('Still processing');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('offline, sending is blocked with a clear message (FR-TRF-11)', async () => {
    const tree = await launch();
    core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    await press(tree, 'quick-send');
    await until(tree, () => has(tree, 'send-offline'));
    core.setNetworkSimulation(NETWORK_NORMAL);
    await press(tree, 'send-offline-retry');
    await until(tree, () => has(tree, 'contact-u-01'));
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('typing your own number says so; an unknown number is not found (FR-TRF-01)', async () => {
    const tree = await launch();
    await press(tree, 'quick-send');
    await until(tree, () => has(tree, 'recipient-search'));
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'recipient-search' }).props.onChangeText('081234567890');
    });
    await until(tree, () => has(tree, 'recipient-self'));
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'recipient-search' }).props.onChangeText('+62 899-0000-1234');
    });
    await until(tree, () => has(tree, 'recipient-not-found'));
    ReactTestRenderer.act(() => tree.unmount());
  });
});

describe('send copy', () => {
  const draft = {
    recipient: { userId: 'u-01', name: 'Andi', phone: '+6281234567781' },
    balance: 1_459_085,
    dailyRemaining: 165_000,
    minAmount: 100,
    maxAmount: 165_000,
  };
  const fmt = (m: number) => core.formatMoney(m);

  it('names the limit that was crossed, and offers the maximum', () => {
    const over = { ok: false, minor: 200_000, reason: 'DAILY_LIMIT_EXCEEDED' as const, acceptInput: true };
    expect(amountMessage(over, draft, fmt)).toBe("That's over today's limit. You can send up to $1,650.00 today.");
    expect(canOfferMax(over, draft)).toBe(true);
    const reached = { ...draft, dailyRemaining: 0, maxAmount: 0 };
    expect(amountMessage(over, reached, fmt)).toBe("You've reached today's transfer limit.");
    expect(canOfferMax(over, reached)).toBe(false);
    expect(amountMessage({ ok: false, reason: 'EMPTY', acceptInput: true }, draft, fmt)).toBeNull();
  });

  it('result titles follow the state and retryability (requirements §4.3)', () => {
    expect(
      resultCopy({ id: 'x', state: 'FAILED', auth: 'OK', failureReason: 'INSUFFICIENT_FUNDS', retryable: false }),
    ).toEqual({
      title: 'Transfer declined',
      message: "Your balance isn't enough for this transfer.",
    });
    expect(resultCopy({ id: 'x', state: 'PENDING', auth: 'OK' }).title).toBe('Still processing');
  });
});
