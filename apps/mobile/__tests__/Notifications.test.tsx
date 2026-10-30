/**
 * @format
 */

import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { LIVE_DATASET, NETWORK_NORMAL } from '@pocketly/core-contract';
import type { AppNotification, Transaction } from '@pocketly/core-contract';
import App from '../App';
import { core } from '../src/core';
import { badgeLabel, notificationText } from '../src/features/notifications/notificationCopy';
import { BANNER_QUEUE_MAX, NotificationsProvider } from '../src/features/notifications/NotificationsProvider';

/** Slice 7 (F9, ADR-0017 §4): banner, bell badge, list, and the locked-queue rule, through the real jsCore. */
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

const settle = () =>
  ReactTestRenderer.act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  });

beforeEach(async () => {
  core.setNetworkSimulation(NETWORK_NORMAL);
  await core.resetData(LIVE_DATASET); // clears the notifications too
});

describe('notification copy (ADR-0017 §3)', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 'trf-1',
    idempotencyKey: 'k',
    type: 'TRANSFER_OUT',
    category: 'TRANSFER',
    amount: 2_500,
    counterparty: { kind: 'USER', id: 'u-02', name: 'Budi Santoso', phone: '+6281200000002' },
    status: 'SUCCESS',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });
  const n = (kind: AppNotification['kind'], t: Transaction): AppNotification => ({
    id: 'evt-1',
    kind,
    transaction: t,
    createdAt: 0,
    read: false,
  });

  it.each([
    ['MONEY_RECEIVED', tx({ type: 'TRANSFER_IN' }), 'Money received', '+$25.00 from Budi Santoso'],
    ['TRANSACTION_SETTLED', tx({}), 'Transfer sent', 'Your transfer of $25.00 to Budi Santoso went through'],
    [
      'TRANSACTION_SETTLED',
      tx({ status: 'FAILED', failureReason: 'SERVER_ERROR' }),
      'Transfer failed',
      "Your transfer of $25.00 to Budi Santoso didn't go through",
    ],
    [
      'TRANSACTION_SETTLED',
      tx({ type: 'TOP_UP', category: 'TOP_UP', counterparty: { kind: 'PAYMENT_METHOD', id: 'pm-card', name: 'Card' } }),
      'Money added',
      'Your top-up of $25.00 went through',
    ],
    [
      'TRANSACTION_SETTLED',
      tx({ type: 'TOP_UP', status: 'FAILED', failureReason: 'PAYMENT_DECLINED' }),
      'Top-up failed',
      "Your top-up of $25.00 didn't go through",
    ],
    [
      'TRANSACTION_SETTLED',
      tx({ type: 'QR_PAYMENT', counterparty: { kind: 'MERCHANT', id: 'm-03', name: 'Metro Transit' } }),
      'Payment complete',
      'Your payment of $25.00 to Metro Transit went through',
    ],
  ] as const)('%s %#', (kind, t, title, body) => {
    expect(notificationText(n(kind, t))).toEqual({ title, body });
  });

  it('badge: nothing at 0, the count up to 9, then 9+ (FR-NOTIF-03)', () => {
    expect([0, 1, 9, 10, 50].map(badgeLabel)).toEqual([null, '1', '9', '9+', '9+']);
  });
});

describe('notifications in the app (F9, jsCore)', () => {
  it('an incoming transfer shows a banner and a badge; View opens the transaction (FR-NOTIF-01)', async () => {
    const tree = await launch();
    await until(tree, () => has(tree, 'balance'));
    expect(has(tree, 'header-bell-badge')).toBe(false);

    let tx!: Transaction;
    await ReactTestRenderer.act(async () => {
      tx = await core.simulateIncomingTransfer();
    });
    await until(tree, () => has(tree, 'notification-banner'));
    expect(text(tree, 'notification-banner-title')).toBe('Money received');
    expect(text(tree, 'notification-banner-body')).toBe(`+${core.formatMoney(tx.amount)} from ${tx.counterparty!.name}`);
    await until(tree, () => has(tree, 'header-bell-badge'));
    // Home reloaded behind it.
    await until(tree, () => has(tree, `tx-${tx.id}`));

    await press(tree, 'notification-banner-view');
    await until(tree, () => has(tree, 'detail-id'));
    expect(text(tree, 'detail-id')).toBe(tx.id);
    expect(has(tree, 'notification-banner')).toBe(false);
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('the bell opens the list, which shows what was new and clears the badge (FR-NOTIF-03)', async () => {
    const tree = await launch();
    await until(tree, () => has(tree, 'balance'));
    await ReactTestRenderer.act(async () => {
      await core.simulateIncomingTransfer();
      await core.simulateIncomingTransfer();
    });
    await until(tree, () => has(tree, 'header-bell-badge') && text(tree, 'header-bell-badge') === '2');
    await press(tree, 'notification-banner-dismiss');

    await press(tree, 'header-bell');
    await until(tree, () => has(tree, 'notification-evt-2'));
    expect(has(tree, 'notification-evt-1')).toBe(true);
    expect(has(tree, 'notification-unread-evt-2')).toBe(true); // this visit still shows them as new
    expect((await core.getNotifications()).unreadCount).toBe(0);
    await until(tree, () => !has(tree, 'header-bell-badge'));

    await press(tree, 'notification-evt-1');
    await until(tree, () => has(tree, 'detail-id'));
    expect(text(tree, 'detail-id')).toBe('sim-000001');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('the list is empty at first', async () => {
    const tree = await launch();
    await press(tree, 'header-bell');
    await until(tree, () => has(tree, 'notifications-empty'));
    ReactTestRenderer.act(() => tree.unmount());
  });

  it("the developer menu's incoming transfer is a real notification, shown once the menu closes (FR-DEV-04)", async () => {
    const tree = await launch();
    await press(tree, 'tab-profile');
    await ReactTestRenderer.act(async () => {
      const version = tree.root.findByProps({ testID: 'app-version' });
      for (let i = 0; i < 7; i++) version.props.onPress();
    });
    await press(tree, 'devmenu-incoming');
    await until(tree, () => text(tree, 'devmenu-status').startsWith('Received $'));
    await settle();
    expect(has(tree, 'notification-banner')).toBe(false); // the menu holds it
    expect(text(tree, 'header-bell-badge')).toBe('1');

    await press(tree, 'devmenu-close');
    await until(tree, () => has(tree, 'notification-banner'));
    expect(text(tree, 'notification-banner-title')).toBe('Money received');
    ReactTestRenderer.act(() => tree.unmount());
  });
});

describe('banners wait while held (ADR-0011, ADR-0017 §4)', () => {
  function host(held: boolean, onView = jest.fn()) {
    return (
      <NotificationsProvider held={held} onView={onView}>
        <View />
      </NotificationsProvider>
    );
  }

  it('nothing shows while locked; the queued one shows after unlocking', async () => {
    let tree!: Tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(host(true));
    });
    await ReactTestRenderer.act(async () => {
      await core.simulateIncomingTransfer();
    });
    await settle();
    expect((await core.getNotifications()).unreadCount).toBe(1); // the core has it
    expect(has(tree, 'notification-banner')).toBe(false); // the lock screen shows nothing of it

    await ReactTestRenderer.act(async () => {
      tree.update(host(false));
    });
    await until(tree, () => has(tree, 'notification-banner'));
    expect(text(tree, 'notification-banner-title')).toBe('Money received');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it(`a burst keeps the newest ${BANNER_QUEUE_MAX} banners, oldest first`, async () => {
    let tree!: Tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(host(true));
    });
    const made: Transaction[] = [];
    await ReactTestRenderer.act(async () => {
      for (let i = 0; i < 5; i++) made.push(await core.simulateIncomingTransfer());
    });
    await settle();
    await ReactTestRenderer.act(async () => {
      tree.update(host(false));
    });
    const shown: string[] = [];
    for (let i = 0; i < BANNER_QUEUE_MAX; i++) {
      await until(tree, () => has(tree, 'notification-banner'));
      shown.push(text(tree, 'notification-banner-body'));
      await press(tree, 'notification-banner-dismiss');
    }
    expect(has(tree, 'notification-banner')).toBe(false);
    expect(shown).toEqual(
      made.slice(-BANNER_QUEUE_MAX).map((t) => `+${core.formatMoney(t.amount)} from ${t.counterparty!.name}`),
    );
    ReactTestRenderer.act(() => tree.unmount());
  });
});
