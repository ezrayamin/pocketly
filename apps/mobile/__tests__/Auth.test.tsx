/**
 * @format
 */

import React from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PIN_LOCKOUT_MS, PIN_MAX_ATTEMPTS } from '@pocketly/core-contract';
import { useSecureScreen } from '@pocketly/native-secure-screen';
import App from '../App';
import { core } from '../src/core';

/** Slice 5 steps 2–3: PIN creation, unlock and the app-lock lifecycle through the real jsCore. */

// Jest runs on Node; the app's TS config declares neither.
declare const performance: { now(): number };
declare const process: { hrtime: { bigint(): bigint } };

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

describe('app lock lifecycle (FR-LOCK-02/03)', () => {
  let listeners: ((state: AppStateStatus) => void)[];
  let offsetMs: number;

  /** Moves both clocks the gate reads (appLock.ts) forward. */
  const advance = (ms: number) => {
    offsetMs += ms;
  };

  async function appState(tree: Tree, state: AppStateStatus) {
    await ReactTestRenderer.act(async () => {
      for (const listener of [...listeners]) listener(state);
    });
    await until(tree, () => true);
  }

  /** The app behind the gate: mounted, and whether it can be touched. */
  function appLayer(tree: Tree) {
    const balance = tree.root.findAll((n) => n.props.testID === 'balance');
    const blocked = tree.root.findAll((n) => n.props.pointerEvents === 'none' && n.props.importantForAccessibility === 'no-hide-descendants');
    return { mounted: balance.length > 0, interactive: balance.length > 0 && blocked.length === 0 };
  }

  async function openApp(): Promise<Tree> {
    const tree = await launch();
    await enter(tree, GOOD);
    await until(tree, () => has(tree, 'balance'));
    await until(tree, () => true);
    return tree;
  }

  beforeEach(async () => {
    listeners = [];
    offsetMs = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: () => listeners.splice(listeners.indexOf(listener as (state: AppStateStatus) => void), 1) };
    });
    const realNow = Date.now.bind(Date);
    // A monotonic clock of our own: the preset's performance.now goes through the mocked Date.now.
    const monoNow = () => Number(process.hrtime.bigint() / 1_000_000n);
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offsetMs);
    jest.spyOn(performance, 'now').mockImplementation(() => monoNow() + offsetMs);
    await core.setPin(GOOD);
    await core.setAutoLockTimeout(5_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('covers the app as soon as it leaves the foreground, and uncovers it on a quick return', async () => {
    const tree = await openApp();
    await appState(tree, 'background');
    expect(has(tree, 'privacy-cover')).toBe(true);
    expect(appLayer(tree).interactive).toBe(false);
    advance(4_000);
    await appState(tree, 'active');
    expect(has(tree, 'privacy-cover')).toBe(false);
    expect(has(tree, 'unlock')).toBe(false);
    expect(appLayer(tree).interactive).toBe(true);
    tree.unmount();
  });

  it('locks again after the timeout, over the still-mounted app, and the PIN opens it', async () => {
    const tree = await openApp();
    await appState(tree, 'background');
    advance(5_000);
    await appState(tree, 'active');
    expect(has(tree, 'unlock')).toBe(true);
    expect(has(tree, 'privacy-cover')).toBe(false);
    expect(appLayer(tree)).toEqual({ mounted: true, interactive: false });
    await enter(tree, GOOD);
    await until(tree, () => !has(tree, 'unlock'));
    expect(appLayer(tree)).toEqual({ mounted: true, interactive: true });
    tree.unmount();
  });

  it('counts the larger of the two clocks: moving the wall clock back doesn\'t skip the lock', async () => {
    const tree = await openApp();
    await appState(tree, 'background');
    const perfNow = performance.now as jest.Mock;
    const base = perfNow();
    perfNow.mockImplementation(() => base + 6_000); // 6 s awake in the background…
    offsetMs = -60 * 60_000; // …while the wall clock was set back an hour
    await appState(tree, 'active');
    expect(has(tree, 'unlock')).toBe(true);
    tree.unmount();
  });

  it('timeout 0 locks on every return; "inactive" alone (iOS app switcher) only covers', async () => {
    await core.setAutoLockTimeout(0);
    const tree = await openApp();
    await appState(tree, 'inactive');
    expect(has(tree, 'privacy-cover')).toBe(true);
    advance(60 * 60_000);
    await appState(tree, 'active');
    expect(has(tree, 'unlock')).toBe(false);
    await appState(tree, 'background');
    await appState(tree, 'active');
    expect(has(tree, 'unlock')).toBe(true);
    tree.unmount();
  });
});
