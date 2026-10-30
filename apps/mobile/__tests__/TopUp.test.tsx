/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LIVE_DATASET, NETWORK_NORMAL } from '@pocketly/core-contract';
import type { NetworkSimulation } from '@pocketly/core-contract';
import { verifyTestPhone } from '@pocketly/core-contract/src/testing/onboarding';
import App from '../App';
import { core } from '../src/core';
import { DevMenu } from '../src/features/devmenu/DevMenu';
import { applyDevLink } from '../src/features/devmenu/devLinks';
import { amountMessage, resultCopy } from '../src/features/topup/topUpCopy';

/** Slice 7 (F6): the Top-Up flow through the real jsCore, Home → amount → method → review → result. */
const PIN = '482915';
const START = 1_459_085; // LIVE_DATASET's balance
/** No 2–5 s processing wait in tests (ADR-0015 §4). */
const INSTANT: NetworkSimulation = { ...NETWORK_NORMAL, topUpProcessingMs: 0 };
jest.setTimeout(20_000);
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

function disabled(tree: Tree, testID: string): boolean {
  const button = tree.root.findAll((n) => n.props.testID === testID && n.props.accessibilityState !== undefined)[0];
  return button.props.accessibilityState.disabled;
}

/** Home → Top-Up → $50 preset → method → review. */
async function toReview(tree: Tree, method: 'BANK_TRANSFER' | 'CARD' = 'CARD') {
  await press(tree, 'quick-topup');
  await until(tree, () => has(tree, 'topup-amount'));
  await press(tree, 'topup-preset-5000');
  await press(tree, 'topup-amount-continue');
  await until(tree, () => has(tree, 'topup-method'));
  await press(tree, `topup-method-${method}`);
  await press(tree, 'topup-method-continue');
  await until(tree, () => has(tree, 'topup-review'));
}

beforeAll(async () => {
  await core.resetAuth();
  await verifyTestPhone(core);
  await core.setPin(PIN);
});

beforeEach(async () => {
  core.setNetworkSimulation(INSTANT);
  await core.resetData(LIVE_DATASET);
});

afterEach(() => core.setNetworkSimulation(NETWORK_NORMAL));

describe('Top-Up flow (F6, jsCore)', () => {
  it('adds money with no PIN, shows Money added, and Home shows the new balance (FR-TOP-01..03)', async () => {
    const tree = await launch();
    await toReview(tree, 'CARD');
    expect(text(tree, 'topup-review-amount')).toBe('$50.00');
    expect(text(tree, 'topup-review-fee')).toBe('Free');
    expect(text(tree, 'topup-review-balance-after')).toBe('$14,640.85');

    await press(tree, 'topup-review-confirm');
    await until(tree, () => has(tree, 'topup-result-success'));
    expect(text(tree, 'topup-result-title')).toBe('Money added');
    expect(text(tree, 'topup-result-tx-id')).toBe('tup-1');
    expect(text(tree, 'topup-result-balance')).toBe('$14,640.85');
    expect(has(tree, 'send-pin')).toBe(false);

    await press(tree, 'topup-result-done');
    await until(tree, () => has(tree, 'balance') && text(tree, 'balance') === '$14,640.85');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it("the keypad and the limits: below 5.00 and above 1,000.00 say so and can't continue", async () => {
    const tree = await launch();
    await press(tree, 'quick-topup');
    await until(tree, () => has(tree, 'topup-amount'));
    expect(text(tree, 'topup-limits')).toBe('$5.00 to $1,000.00 per top-up');
    await typeAmount(tree, '4');
    expect(text(tree, 'topup-amount-error')).toBe('The smallest top-up is $5.00.');
    expect(disabled(tree, 'topup-amount-continue')).toBe(true);
    await typeAmount(tree, '000.019'); // the third decimal is dropped
    expect(text(tree, 'topup-amount-display')).toBe('$4000.01');
    expect(text(tree, 'topup-amount-error')).toBe('You can top up at most $1,000.00 at a time.');
    expect(disabled(tree, 'topup-amount-continue')).toBe(true);
    await press(tree, 'topup-preset-2500');
    expect(text(tree, 'topup-amount-display')).toBe('$25.00');
    expect(has(tree, 'topup-amount-error')).toBe(false);
    expect(disabled(tree, 'topup-amount-continue')).toBe(false);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('declined by the payment method: not retryable, balance unchanged, another method offered', async () => {
    const tree = await launch();
    await toReview(tree, 'CARD');
    core.setNetworkSimulation({ ...INSTANT, declineTopUps: true });
    await press(tree, 'topup-review-confirm');
    await until(tree, () => has(tree, 'topup-result-failed'));
    expect(text(tree, 'topup-result-title')).toBe('Top-up declined');
    expect(text(tree, 'topup-result-message')).toBe(
      'Your payment method declined this top-up. Try another method or amount.',
    );
    expect(text(tree, 'topup-result-balance')).toBe('$14,590.85 (unchanged)');
    expect(has(tree, 'topup-result-retry')).toBe(false);

    core.setNetworkSimulation(INSTANT);
    await press(tree, 'topup-result-other-method');
    await until(tree, () => has(tree, 'topup-method'));
    expect(text(tree, 'topup-method-amount')).toBe('Add $50.00 from');
    expect((await core.getWallet()).balance).toBe(START);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('a server error offers Retry with the same key; it then goes through once', async () => {
    const tree = await launch();
    await toReview(tree, 'BANK_TRANSFER');
    core.setNetworkSimulation({ mode: 'ALWAYS_FAIL', failureRatePercent: 0 });
    await press(tree, 'topup-review-confirm');
    await until(tree, () => has(tree, 'topup-result-failed'));
    expect(text(tree, 'topup-result-title')).toBe("Top-up didn't go through");

    core.setNetworkSimulation(INSTANT);
    await press(tree, 'topup-result-retry');
    await until(tree, () => has(tree, 'topup-result-success'));
    expect((await core.getWallet()).balance).toBe(START + 5_000);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('processing longer than the timeout (here 100 ms) is Still processing, not yet in the balance', async () => {
    const tree = await launch();
    await toReview(tree, 'CARD');
    core.setNetworkSimulation({ ...NETWORK_NORMAL, topUpProcessingMs: 300, writeTimeoutMs: 100 });
    await press(tree, 'topup-review-confirm');
    await until(tree, () => has(tree, 'topup-result-pending'));
    expect(text(tree, 'topup-result-title')).toBe('Still processing');
    expect(has(tree, 'topup-result-view')).toBe(true);
    expect((await core.getWallet()).balance).toBe(START);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('offline, the amount step still works and the method step says why it stops', async () => {
    const tree = await launch();
    core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    await press(tree, 'quick-topup');
    await press(tree, 'topup-preset-1000');
    await press(tree, 'topup-amount-continue');
    await press(tree, 'topup-method-continue');
    await until(tree, () => has(tree, 'topup-offline'));
    core.setNetworkSimulation(INSTANT);
    await press(tree, 'topup-method-continue');
    await until(tree, () => has(tree, 'topup-review'));
    ReactTestRenderer.act(() => tree.unmount());
  });
});

describe('developer menu: decline top-ups', () => {
  it('the switch and the dev link set declineTopUps', async () => {
    let tree!: Tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<DevMenu visible lockSkipped onClose={() => {}} />);
    });
    const toggle = () => tree.root.findByProps({ testID: 'devmenu-decline-topups' });
    expect(toggle().props.value).toBe(false);
    await ReactTestRenderer.act(async () => toggle().props.onValueChange(true));
    expect(core.getNetworkSimulation().declineTopUps).toBe(true);
    expect(toggle().props.value).toBe(true);
    ReactTestRenderer.act(() => tree.unmount());

    await applyDevLink('pocketly://dev/network?declineTopUps=false&topUpProcessingMs=0');
    expect(core.getNetworkSimulation()).toMatchObject({ declineTopUps: false, topUpProcessingMs: 0 });
    await expect(applyDevLink('pocketly://dev/network?declineTopUps=yes')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('top-up copy', () => {
  const fmt = (m: number) => core.formatMoney(m);

  it('names the limit, and says nothing for empty or zero', () => {
    expect(amountMessage({ ok: false, minor: 499, reason: 'BELOW_MINIMUM', acceptInput: true }, fmt)).toBe(
      'The smallest top-up is $5.00.',
    );
    expect(amountMessage({ ok: false, minor: 0, reason: 'BELOW_MINIMUM', acceptInput: true }, fmt)).toBeNull();
    expect(amountMessage({ ok: false, reason: 'EMPTY', acceptInput: true }, fmt)).toBeNull();
  });

  it('result titles follow the state and retryability', () => {
    expect(resultCopy({ id: 'x', state: 'SUCCESS', auth: 'NOT_REQUIRED' }).title).toBe('Money added');
    expect(
      resultCopy({ id: 'x', state: 'FAILED', auth: 'NOT_REQUIRED', failureReason: 'SERVER_ERROR', retryable: true })
        .title,
    ).toBe("Top-up didn't go through");
    expect(resultCopy({ id: 'x', state: 'PENDING', auth: 'NOT_REQUIRED' }).title).toBe('Still processing');
  });
});
