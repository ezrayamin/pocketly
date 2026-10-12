/**
 * @format
 */

import React from 'react';
import { Share } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { Transaction } from '@pocketly/core-contract';
import App from '../App';
import { core } from '../src/core';
import { HISTORY_PAGE_SIZE } from '../src/features/history/useHistory';
import type { HistoryRow } from '../src/features/history/rows';
import { toRows } from '../src/features/history/rows';

async function renderHistory() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App launchArgs={{ skipLock: 'true' }} />);
  });
  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({ testID: 'tab-history' }).props.onPress();
  });
  return tree;
}

/** The FlashList's own props (data, onEndReached, …), not one of its host views. */
function list(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.find((n) => n.props.testID === 'history-list' && Array.isArray(n.props.data));
}

function transactions(tree: ReactTestRenderer.ReactTestRenderer): Transaction[] {
  return (list(tree).props.data as HistoryRow[]).flatMap((row) => (row.kind === 'tx' ? [row.tx] : []));
}

async function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({ testID }).props.onPress();
  });
}

function text(node: ReactTestRenderer.ReactTestInstance): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c);
}

afterEach(() => {
  core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 });
  jest.restoreAllMocks();
});

describe('History (jsCore)', () => {
  it('loads 20 per page, newest first, and appends the next page without duplicates (FR-HIST-01)', async () => {
    const tree = await renderHistory();
    const first = transactions(tree);
    expect(first).toHaveLength(HISTORY_PAGE_SIZE);

    await ReactTestRenderer.act(async () => {
      // A burst of end-reached events must fetch the next page once.
      list(tree).props.onEndReached();
      list(tree).props.onEndReached();
    });
    const both = transactions(tree);
    expect(both).toHaveLength(2 * HISTORY_PAGE_SIZE);
    expect(new Set(both.map((tx) => tx.id)).size).toBe(both.length);
    expect(both.slice(0, HISTORY_PAGE_SIZE)).toEqual(first);
    for (let i = 1; i < both.length; i++) {
      expect(both[i - 1].createdAt).toBeGreaterThanOrEqual(both[i].createdAt);
    }
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('groups rows under one header per local day (FR-HIST-02)', async () => {
    const tree = await renderHistory();
    const rows = list(tree).props.data as HistoryRow[];
    expect(rows[0].kind).toBe('day');
    const headers = rows.filter((r) => r.kind === 'day');
    expect(new Set(headers.map((h) => h.key)).size).toBe(headers.length);
    expect(list(tree).props.stickyHeaderIndices).toEqual(rows.flatMap((r, i) => (r.kind === 'day' ? [i] : [])));
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('filters by type and status, and offers to clear an empty result (FR-HIST-03)', async () => {
    const tree = await renderHistory();
    await press(tree, 'filter-type-TOP_UP');
    const topUps = transactions(tree);
    expect(topUps.length).toBeGreaterThan(0);
    expect(topUps.every((tx) => tx.type === 'TOP_UP')).toBe(true);

    await press(tree, 'filter-status-FAILED');
    expect(transactions(tree).every((tx) => tx.type === 'TOP_UP' && tx.status === 'FAILED')).toBe(true);
    if (transactions(tree).length === 0) {
      await press(tree, 'history-clear-filters');
      expect(transactions(tree)).toHaveLength(HISTORY_PAGE_SIZE);
    }
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('offline, shows the cached list with a banner dated from the last sync (FR-HIST-04)', async () => {
    const tree = await renderHistory();
    const online = transactions(tree);
    expect(tree.root.findAllByProps({ testID: 'history-error' })).toHaveLength(0);

    core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    await ReactTestRenderer.act(async () => {
      list(tree).props.onRefresh();
    });
    expect(transactions(tree)).toEqual(online);
    const banner = tree.root.findByProps({ testID: 'history-error' });
    expect(JSON.stringify(banner.findAllByType('Text' as never).map((t) => t.props.children))).toContain("You're offline");
    expect(text(tree.root.findByProps({ testID: 'history-last-updated' }))).toMatch(/^Last updated \S/);

    // Later pages read the replica, so scrolling still works offline.
    await ReactTestRenderer.act(async () => {
      list(tree).props.onEndReached();
    });
    expect(transactions(tree)).toHaveLength(2 * HISTORY_PAGE_SIZE);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('a slow response for an old filter never replaces the current one (latest-request guard)', async () => {
    const tree = await renderHistory();
    // Real timers: the delay is short, and fake ones would leak into the tests after this one.
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0, normalLatencyMs: 300 });
    await press(tree, 'filter-type-TOP_UP'); // slow
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 });
    await press(tree, 'filter-type-QR_PAYMENT'); // fast, wins
    expect(transactions(tree).every((tx) => tx.type === 'QR_PAYMENT')).toBe(true);

    await ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 400)); // the TOP_UP page lands now
    });
    const shown = transactions(tree);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((tx) => tx.type === 'QR_PAYMENT')).toBe(true);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('opens a detail screen with copy ID and share receipt (FR-HIST-05)', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const tree = await renderHistory();
    const tx = transactions(tree)[0];

    await press(tree, `history-row-${tx.id}`);
    expect(text(tree.root.findByProps({ testID: 'detail-id' }))).toBe(tx.id);
    expect(text(tree.root.findByProps({ testID: 'detail-amount' }))).toContain(core.formatMoney(tx.amount));

    await press(tree, 'detail-copy-id');
    expect(share).toHaveBeenLastCalledWith({ message: tx.id });

    await press(tree, 'detail-share');
    const receipt = share.mock.calls[share.mock.calls.length - 1][0] as { message: string };
    expect(receipt.message).toContain(`Transaction ID: ${tx.id}`);
    expect(receipt.message).toContain(core.formatMoney(tx.amount));
    ReactTestRenderer.act(() => tree.unmount());
  });
});

describe('toRows', () => {
  const at = (iso: string) => new Date(iso).getTime();
  const tx = (id: string, createdAt: number) => ({ id, createdAt }) as Transaction;

  it('labels Today, Yesterday, then full dates', () => {
    const now = at('2026-10-04T15:00:00');
    const { rows, dayIndices } = toRows(
      [
        tx('a', at('2026-10-04T09:00:00')),
        tx('b', at('2026-10-04T08:00:00')),
        tx('c', at('2026-10-03T23:00:00')),
        tx('d', at('2026-09-30T10:00:00')),
        tx('e', at('2025-12-31T10:00:00')),
      ],
      now,
    );
    expect(rows.map((r) => (r.kind === 'day' ? r.title : r.key))).toEqual([
      'Today', 'a', 'b', 'Yesterday', 'c', 'September 30, 2026', 'd', 'December 31, 2025', 'e',
    ]);
    expect(dayIndices).toEqual([0, 3, 5, 7]);
  });
});
