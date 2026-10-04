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
