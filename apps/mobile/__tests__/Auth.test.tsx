/**
 * @format
 */

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PIN_LOCKOUT_MS, PIN_MAX_ATTEMPTS } from '@pocketly/core-contract';
import { useSecureScreen } from '@pocketly/native-secure-screen';
import App from '../App';
import { core } from '../src/core';

/** Slice 5 step 2: PIN creation and unlock through the real jsCore (FR-AUTH-03, FR-LOCK-01/04). */

const GOOD = '482915';
const WRONG = '731048';

type Tree = ReactTestRenderer.ReactTestRenderer;

async function launch(): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  await until(tree, () => !has(tree, 'auth-checking'));
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

/** Waits for async core work (PBKDF2 runs on libuv's thread pool) to land in the tree. */
async function until(tree: Tree, condition: () => boolean, timeoutMs = 5_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the UI');
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}

async function enter(tree: Tree, pin: string) {
  for (const digit of pin) {
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: `pin-key-${digit}` }).props.onPress();
    });
  }
  await until(tree, () => !has(tree, 'pin-busy'));
}

beforeEach(async () => {
  await core.resetAuth();
  jest.mocked(useSecureScreen).mockClear();
});

describe('first launch: create a PIN (FR-AUTH-03)', () => {
  it('shows the PIN setup before anything financial (FR-LOCK-01), with screenshots blocked', async () => {
    const tree = await launch();
    expect(has(tree, 'create-pin')).toBe(true);
    expect(has(tree, 'balance')).toBe(false);
    expect(useSecureScreen).toHaveBeenCalled();
    tree.unmount();
  });

  it('refuses a trivial PIN with the reason, before asking to confirm it', async () => {
    const tree = await launch();
    await enter(tree, '123456');
    expect(text(tree, 'pin-title')).toBe('Create a PIN');
    expect(text(tree, 'pin-message')).toBe('Too simple: avoid repeated or sequential digits.');
    tree.unmount();
  });

  it('starts over when the confirmation differs', async () => {
    const tree = await launch();
    await enter(tree, GOOD);
    expect(text(tree, 'pin-title')).toBe('Confirm your PIN');
    await enter(tree, WRONG);
    expect(text(tree, 'pin-title')).toBe('Create a PIN');
    expect(text(tree, 'pin-message')).toBe("The PINs didn't match. Choose your PIN again.");
    expect((await core.getAuthState()).pinSet).toBe(false);
    tree.unmount();
  });

  it('saves the PIN and opens the app', async () => {
    const tree = await launch();
    await enter(tree, GOOD);
    await enter(tree, GOOD);
    await until(tree, () => has(tree, 'balance'));
    expect((await core.getAuthState()).pinSet).toBe(true);
    tree.unmount();
  });

  it('announces how many digits are in, never which', async () => {
    const tree = await launch();
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'pin-key-4' }).props.onPress();
      tree.root.findByProps({ testID: 'pin-key-8' }).props.onPress();
    });
    const dots = tree.root.findAll((n) => n.props.testID === 'pin-dots')[0];
    expect(dots.props.accessibilityLabel).toBe('2 of 6 digits entered');
    const shown = tree.root
      .findAll((n) => (n.type as unknown) === 'Text')
      .flatMap((n) => ([] as unknown[]).concat(n.props.children).filter((c): c is string => typeof c === 'string'));
    expect(shown.filter((t) => t.includes('48'))).toEqual([]);
    tree.unmount();
  });
});

describe('later launches: unlock (FR-LOCK-01/04)', () => {
  beforeEach(async () => {
    await core.setPin(GOOD);
  });

  it('asks for the PIN, counts wrong ones, and opens on the right one', async () => {
    const tree = await launch();
    expect(has(tree, 'unlock')).toBe(true);
    expect(has(tree, 'balance')).toBe(false);
    await enter(tree, WRONG);
    expect(text(tree, 'pin-message')).toBe(`Wrong PIN. ${PIN_MAX_ATTEMPTS - 1} attempts left.`);
    await enter(tree, GOOD);
    await until(tree, () => has(tree, 'balance'));
    tree.unmount();
  });

  it('locks out after 5 wrong PINs with a live countdown, which a restart doesn\'t end', async () => {
    const tree = await launch();
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) await enter(tree, WRONG);
    expect(text(tree, 'pin-message')).toMatch(/^Too many wrong PINs\. Try again in [45]:\d\d\.$/);
    expect(tree.root.findByProps({ testID: 'pin-key-1' }).props.disabled).toBe(true);
    tree.unmount();

    const again = await launch();
    expect(text(again, 'pin-message')).toMatch(/Try again in [45]:\d\d/);
    expect((await core.getAuthState()).lockedUntil).toBeGreaterThan(Date.now() + PIN_LOCKOUT_MS - 60_000);
    again.unmount();
  });

  it('"Forgot PIN" deletes the PIN and starts setup again', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const tree = await launch();
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'pin-forgot' }).props.onPress();
    });
    await until(tree, () => has(tree, 'create-pin'));
    expect((await core.getAuthState()).pinSet).toBe(false);
    alert.mockRestore();
    tree.unmount();
  });

  it('when secure storage is unavailable, stays locked without wiping, and retries', async () => {
    // The object core-js calls (an `import * as` would get Babel's copy of it).
    const sensitiveInfo = jest.requireMock<{ getItem: (...args: unknown[]) => Promise<unknown> }>('react-native-sensitive-info');
    const getItem = jest.spyOn(sensitiveInfo, 'getItem').mockRejectedValue(new Error('device locked'));
    const tree = await launch();
    expect(has(tree, 'auth-unavailable')).toBe(true);
    expect(has(tree, 'balance')).toBe(false);
    getItem.mockRestore();
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'auth-retry' }).props.onPress();
    });
    await until(tree, () => has(tree, 'unlock'));
    expect((await core.getAuthState()).pinSet).toBe(true);
    tree.unmount();
  });
});
