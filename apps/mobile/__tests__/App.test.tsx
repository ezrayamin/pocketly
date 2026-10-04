/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { uiPreferences } from '@pocketly/native-preferences';
import { core } from '../src/core';


async function renderApp() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  return tree;
}

function text(node: ReactTestRenderer.ReactTestInstance): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c);
}

describe('Home (jsCore)', () => {
  afterEach(async () => {
    await uiPreferences.setBalanceHidden(false);
  });

  it('shows the balance and the 5 most recent transactions', async () => {
    const tree = await renderApp();
    expect(text(tree.root.findByProps({ testID: 'balance' }))).toBe('$14,590.85');
    const ids = [
      ...new Set(
        tree.root
          .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('tx-'))
          .map((n) => n.props.testID as string),
      ),
    ];
    // Exactly 5 rows, newest first (the order the core returns).
    const { items } = await core.getTransactions(undefined, 5);
    expect(ids).toEqual(items.map((t) => `tx-${t.id}`));
    tree.unmount();
  });

  it('hides the balance and persists the choice (FR-HOME-02)', async () => {
    const tree = await renderApp();
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'balance-toggle' }).props.onPress();
    });
    expect(text(tree.root.findByProps({ testID: 'balance' }))).toBe('••••••');
    expect(await uiPreferences.getBalanceHidden()).toBe(true);
    tree.unmount();

    // A fresh mount (≈ app restart) starts hidden.
    const again = await renderApp();
    expect(text(again.root.findByProps({ testID: 'balance' }))).toBe('••••••');
    again.unmount();
  });

  it('pull to refresh reloads from the core (FR-HOME-05)', async () => {
    const tree = await renderApp();
    const spy = jest.spyOn(core, 'getWallet');
    const scroll = tree.root.findByProps({ testID: 'home-scroll' });
    await ReactTestRenderer.act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    tree.unmount();
  });
});

describe('Developer menu (F11)', () => {
  beforeEach(() => {
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 });
  });

  async function openDevMenu(tree: ReactTestRenderer.ReactTestRenderer) {
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'tab-profile' }).props.onPress();
    });
    const version = tree.root.findByProps({ testID: 'app-version' });
    await ReactTestRenderer.act(async () => {
      for (let i = 0; i < 7; i++) version.props.onPress();
    });
  }

  it('opens after tapping the app version 7 times (FR-DEV-01)', async () => {
    const tree = await renderApp();
    expect(tree.root.findAllByProps({ testID: 'devmenu-close' })).toHaveLength(0);
    await openDevMenu(tree);
    expect(tree.root.findAllByProps({ testID: 'devmenu-close' }).length).toBeGreaterThan(0);
    tree.unmount();
  });

  it('offline mode shows the offline message on Home and keeps the cached balance (FR-DEV-02)', async () => {
    const tree = await renderApp();
    await openDevMenu(tree);
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'devmenu-mode-OFFLINE' }).props.onPress();
    });
    expect(core.getNetworkSimulation().mode).toBe('OFFLINE');
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'devmenu-close' }).props.onPress();
    });
    const error = tree.root.findByProps({ testID: 'home-error' });
    expect(JSON.stringify(error.findAllByType('Text' as never).map((t) => t.props.children))).toContain("You're offline");
    expect(text(tree.root.findByProps({ testID: 'balance' }))).toBe('$14,590.85');
    tree.unmount();
  });

  it('a simulated incoming transfer appears on Home after closing (FR-DEV-04)', async () => {
    const tree = await renderApp();
    await openDevMenu(tree);
    await ReactTestRenderer.act(async () => {
      await tree.root.findByProps({ testID: 'devmenu-incoming' }).props.onPress();
    });
    expect(text(tree.root.findByProps({ testID: 'devmenu-status' }))).toContain('Received $');
    await ReactTestRenderer.act(async () => {
      tree.root.findByProps({ testID: 'devmenu-close' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'tx-sim-000001' }).length).toBeGreaterThan(0);
    tree.unmount();
  });
});

describe('Late results (ADR-0007)', () => {
  afterEach(() => {
    jest.useRealTimers();
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 });
  });

  it("an older load failing late doesn't override a newer successful one", async () => {
    const tree = await renderApp();
    jest.useFakeTimers();
    const scroll = () => tree.root.findByProps({ testID: 'home-scroll' });

    // Load A: slow and doomed (fails after 3 s, inside the 10 s timeout).
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 100, normalLatencyMs: 3_000 });
    let loadA!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      loadA = scroll().props.refreshControl.props.onRefresh();
    });

    // Load B: fast and fine, finishes first.
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 });
    await ReactTestRenderer.act(async () => {
      await scroll().props.refreshControl.props.onRefresh();
    });
    expect(tree.root.findAllByProps({ testID: 'home-error' })).toHaveLength(0);

    // A's failure arrives now: it must be ignored.
    await ReactTestRenderer.act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
      await loadA;
    });
    expect(tree.root.findAllByProps({ testID: 'home-error' })).toHaveLength(0);
    expect(scroll().props.refreshControl.props.refreshing).toBe(false);
    tree.unmount();
  });
});

describe('Dev links (ADR-0008)', () => {
  afterEach(() => core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 }));

  it('pocketly://dev/network sets only the given params; bad values are rejected', async () => {
    const { applyDevLink } = require('../src/features/devmenu/devLinks');
    await applyDevLink('pocketly://dev/network?normalLatencyMs=300');
    expect(core.getNetworkSimulation()).toMatchObject({ mode: 'NORMAL', failureRatePercent: 0, normalLatencyMs: 300 });
    await applyDevLink('pocketly://dev/network?mode=OFFLINE');
    expect(core.getNetworkSimulation()).toMatchObject({ mode: 'OFFLINE', normalLatencyMs: 300 });
    await expect(applyDevLink('pocketly://dev/network?failureRatePercent=150')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await applyDevLink('https://example.com')).toBeNull();
  });
});
