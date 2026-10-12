/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LIVE_DATASET } from '@pocketly/core-contract';
import App from '../App';
import { core } from '../src/core';
import { parseLaunchArgs } from '../src/launchArgs';

/** As the benchmark scripts launch it: with skipLock, so Home is reachable. */
async function render(launchArgs: Record<string, string>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App launchArgs={{ skipLock: 'true', ...launchArgs }} />);
  });
  return tree;
}

afterEach(() => core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 }));

describe('parseLaunchArgs (benchmarking.md §5.3)', () => {
  it('reads tab, dataset and network; unset dataset fields come from LIVE_DATASET', () => {
    expect(
      parseLaunchArgs({ tab: 'history', transactionCount: '1000', 'network.normalLatencyMs': '300' }),
    ).toEqual({
      tab: 'history',
      dataset: { seed: LIVE_DATASET.seed, transactionCount: 1000, nowMillis: undefined },
      network: { normalLatencyMs: '300' },
    });
    expect(parseLaunchArgs(undefined)).toEqual({});
  });

  it('rejects unknown keys and bad values instead of falling back to defaults', () => {
    expect(() => parseLaunchArgs({ transactionCont: '1000' })).toThrow(/unknown launch argument/);
    expect(() => parseLaunchArgs({ transactionCount: '1e3x' })).toThrow(/not an integer/);
    expect(() => parseLaunchArgs({ tab: 'pay' })).toThrow(/tab="pay"/);
    expect(() => parseLaunchArgs({ skipLock: 'yes' })).toThrow(/skipLock="yes"/);
  });

  it('reads skipLock (benchmarks reach Home without the PIN gate)', () => {
    expect(parseLaunchArgs({ skipLock: 'true' })).toEqual({ skipLock: true });
    expect(parseLaunchArgs({ skipLock: 'false' })).toEqual({ skipLock: false });
  });
});

describe('App with launch arguments', () => {
  it('applies dataset and network before the first screen loads, and opens the start tab', async () => {
    const tree = await render({ tab: 'history', transactionCount: '1000', 'network.normalLatencyMs': '0' });
    expect(tree.root.findAllByProps({ testID: 'history-list' }).length).toBeGreaterThan(0);
    // 1,000 entries: the whole ledger pages through in 50 pages of 20.
    let cursor: string | undefined;
    let count = 0;
    do {
      const page = await core.getTransactions(cursor, 100);
      count += page.items.length;
      cursor = page.nextCursor;
    } while (cursor);
    expect(count).toBe(1000);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('stops with a visible error on bad arguments', async () => {
    const tree = await render({ 'network.mode': 'WARP' });
    expect(tree.root.findAllByProps({ testID: 'launch-args-error' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'balance' })).toHaveLength(0);
    ReactTestRenderer.act(() => tree.unmount());
  });
});
