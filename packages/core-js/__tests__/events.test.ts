import { DEFAULT_DATASET, NOTIFICATIONS_KEPT } from '@pocketly/core-contract';
import type {
  AppNotification,
  ErrorCode,
  NetworkSimulation,
  Transaction,
  TransactionStatus,
} from '@pocketly/core-contract';
import fixture from '@pocketly/core-contract/fixtures/events.json';
import { CacheStore } from '../src/data/cacheStore';
import { CACHE_SCHEMA, CACHE_VERSION, SERVER_SCHEMA } from '../src/data/db/sql.generated';
import { FakeWalletApi } from '../src/data/fake/fakeWalletApi';
import { ServerStore } from '../src/data/fake/serverStore';
import { UserTimeZone } from '../src/data/timeZone';
import type { EventsPage, TopUpRequest, TransferRequest, WalletApi, WalletEvent } from '../src/data/walletApi';
import { EventSync } from '../src/sync/eventSync';
import { nodeSqliteDriver } from '../testing/nodeSqliteDriver';

/** ADR-0017: the fake server's event log against fixtures/events.json, and the client's rule for what notifies. */

const INSTANT: NetworkSimulation = { mode: 'NORMAL', failureRatePercent: 0, topUpProcessingMs: 0 };

async function openServer(driver = nodeSqliteDriver()): Promise<FakeWalletApi> {
  const api = new FakeWalletApi(new ServerStore(driver), () => new UserTimeZone('UTC'));
  await api.open(DEFAULT_DATASET);
  api.network.set(INSTANT);
  return api;
}

async function error(promise: Promise<unknown>): Promise<ErrorCode | undefined> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return (e as { code?: ErrorCode }).code;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 10));

/** An event as the fixture writes it. */
function shape(e: WalletEvent) {
  const { transaction: tx } = e;
  return {
    id: `evt-${e.seq}`,
    kind: e.kind,
    transactionId: tx.id,
    status: tx.status,
    ...(tx.failureReason !== undefined ? { failureReason: tx.failureReason } : {}),
  };
}

type Step = (typeof fixture.server.steps)[number];

/** Runs one fixture step against the server. */
async function run(api: FakeWalletApi, step: Step): Promise<void> {
  if (step.action === 'incoming') {
    await api.simulateIncomingTransfer();
    return;
  }
  if (step.action === 'advanceClock') {
    api.advanceClock(step.ms!);
    return;
  }
  api.network.set(step.simulation as NetworkSimulation);
  const call =
    step.action === 'transfer'
      ? api.transfer(step.request as TransferRequest, step.key!)
      : api.topUp(step.request as TopUpRequest, step.key!);
  if (step.simulation!.mode === 'TIMEOUT') {
    void call; // never answered
    await tick();
  } else {
    await call;
  }
  api.network.set(INSTANT);
}

describe('fake server: the event log (fixtures/events.json → server, ADR-0017 §1)', () => {
  it('walks the steps: each logs exactly its events, and signals when the log grows', async () => {
    const api = await openServer();
    let signals = 0;
    api.incomingEvents(() => signals++);
    let seq = 0;
    for (const step of fixture.server.steps) {
      const before = signals;
      await run(api, step);
      const page = await api.getEvents(seq, 500);
      expect(page.items.map(shape)).toEqual(step.expect.events);
      expect(page.hasMore).toBe(false);
      for (const event of page.items) {
        expect(`evt-${event.seq}`).toMatch(new RegExp(fixture.params.idPattern));
        expect(event.createdAt).toBe(event.transaction.updatedAt);
      }
      seq = page.items.at(-1)?.seq ?? seq;
      await tick();
      expect(signals - before).toBe(step.expect.events.length);
    }
  });

  it('pages the log oldest first', async () => {
    const api = await openServer();
    for (const step of fixture.server.steps) await run(api, step);
    for (const c of fixture.server.paging.cases) {
      const page = await api.getEvents(c.afterSeq, c.limit);
      expect({ ids: page.items.map((e) => `evt-${e.seq}`), hasMore: page.hasMore }).toEqual({
        ids: c.ids,
        hasMore: c.hasMore,
      });
    }
  });

  it('resetData empties the log and restarts its numbering', async () => {
    const api = await openServer();
    for (const step of fixture.server.steps) await run(api, step);
    await api.reset(DEFAULT_DATASET);
    api.network.set(INSTANT);
    expect((await api.getEvents(0, 10)).items).toEqual([]);
    await api.simulateIncomingTransfer();
    expect((await api.getEvents(0, 10)).items.map(shape)).toEqual(fixture.server.afterReset.events);
  });

  it('refuses a bad page, and reads nothing offline', async () => {
    const api = await openServer();
    for (const [after, limit] of [
      [-1, 10],
      [0, 0],
      [0, 501],
      [0.5, 10],
    ]) {
      expect(await error(api.getEvents(after, limit))).toBe('INVALID_ARGUMENT');
    }
    api.network.set({ mode: 'OFFLINE', failureRatePercent: 0 });
    expect(await error(api.getEvents(0, 10))).toBe('NETWORK_UNAVAILABLE');
    api.network.set({ mode: 'ALWAYS_FAIL', failureRatePercent: 0 });
    expect(await error(api.getEvents(0, 10))).toBe('SERVER_ERROR');
  });

  it('a log read draws nothing from the seeded sequence', async () => {
    const simulation: NetworkSimulation = { mode: 'NORMAL', failureRatePercent: 50, seed: 7 };
    const outcomes = async (api: FakeWalletApi, readEvents: boolean) => {
      api.network.set(simulation);
      const out: string[] = [];
      for (let i = 0; i < 8; i++) {
        if (readEvents) await api.getEvents(0, 10);
        out.push((await error(api.getWallet())) ?? 'OK');
      }
      return out;
    };
    expect(await outcomes(await openServer(), true)).toEqual(await outcomes(await openServer(), false));
  });
});

describe('server and cache schema migrations (ADR-0017)', () => {
  it('server 4 → 5: adds the event log to a version-4 database', async () => {
    const driver = nodeSqliteDriver();
    for (const statement of SERVER_SCHEMA.filter((s) => !/server_event/.test(s))) await driver.exec(statement);
    await driver.exec('PRAGMA user_version = 4');
    await driver.run("INSERT INTO server_meta(key, value) VALUES ('seeded', '1')", []);
    await driver.run("INSERT INTO server_meta(key, value) VALUES ('frozenNowMillis', ?)", [
      String(DEFAULT_DATASET.nowMillis),
    ]);

    const api = await openServer(driver);
    const [row] = await driver.query('PRAGMA user_version', []);
    expect(Number(row.user_version)).toBe(5);
    await api.simulateIncomingTransfer();
    expect((await api.getEvents(0, 10)).items.map(shape)).toEqual(fixture.server.afterReset.events);
  });

  it('cache 1 → 2: adds the notifications to a version-1 replica and keeps its rows', async () => {
    const driver = nodeSqliteDriver();
    for (const statement of CACHE_SCHEMA.filter((s) => !/cache_notification/.test(s))) await driver.exec(statement);
    await driver.exec('PRAGMA user_version = 1');
    const old = incoming('sim-000001');
    const first = new CacheStore(driver);
    await first.upsert(old); // the v1 tables work before migrating
    const cache = new CacheStore(driver);
    await cache.init();
    const [row] = await driver.query('PRAGMA user_version', []);
    expect(Number(row.user_version)).toBe(CACHE_VERSION);
    expect(CACHE_VERSION).toBe(2);
    expect(await cache.get(old.id)).toEqual(old);
    await cache.applyEvent(
      1,
      old,
      { id: 'evt-1', kind: 'MONEY_RECEIVED', createdAt: old.createdAt },
      NOTIFICATIONS_KEPT,
    );
    expect(await cache.notifications(10)).toMatchObject([{ id: 'evt-1', transaction: old, read: false }]);
    expect(await cache.eventCursor()).toBe(1);
  });
});

function incoming(id: string, status: TransactionStatus = 'SUCCESS', key = `key-${id}`): Transaction {
  const now = DEFAULT_DATASET.nowMillis!;
  return {
    id,
    idempotencyKey: key,
    type: 'TRANSFER_IN',
    category: 'TRANSFER',
    amount: 1_000,
    counterparty: { kind: 'USER', id: 'u-01', name: 'Andi Pratama', phone: '+6281234567801' },
    status,
    createdAt: now,
    updatedAt: now,
  };
}

/** A WalletApi that only serves the given log (ignoring nothing: it honors afterSeq unless `replay`). */
function logApi(log: WalletEvent[], replay = false): WalletApi {
  const api: Partial<WalletApi> = {
    async getEvents(afterSeq: number, limit: number): Promise<EventsPage> {
      const after = replay ? log : log.filter((e) => e.seq > afterSeq);
      return { items: after.slice(0, limit), hasMore: after.length > limit };
    },
    incomingEvents: () => () => undefined,
  };
  return api as WalletApi;
}

describe('EventSync: which events notify (fixtures/events.json → client, ADR-0017 §2)', () => {
  it.each(fixture.client.cases)('$kind, replica had $replicaStatusBefore → notifies: $notifies', async (c) => {
    const cache = new CacheStore(nodeSqliteDriver());
    await cache.init();
    const settled = incoming('trf-1', 'SUCCESS', 'k-1');
    if (c.replicaStatusBefore !== null)
      await cache.upsert({ ...settled, status: c.replicaStatusBefore as TransactionStatus });
    const event: WalletEvent = {
      seq: 1,
      kind: c.kind as WalletEvent['kind'],
      transaction: settled,
      createdAt: settled.updatedAt,
    };
    const settledCalls: Transaction[] = [];
    const sync = new EventSync(logApi([event]), cache, async (tx) => void settledCalls.push(tx));
    const got: AppNotification[] = [];
    sync.subscribe((n) => got.push(...n));
    await sync.catchUp();

    expect(got.length).toBe(c.notifies ? 1 : 0);
    expect((await cache.notifications(10)).length).toBe(c.notifies ? 1 : 0);
    expect(settledCalls.length).toBe(c.kind === 'TRANSACTION_SETTLED' && c.notifies ? 1 : 0);
    expect(await cache.get('trf-1')).toEqual(settled); // applied either way
    expect(await cache.eventCursor()).toBe(1);
  });

  it("the app's own pending row (by key) counts as PENDING, and goes", async () => {
    const cache = new CacheStore(nodeSqliteDriver());
    await cache.init();
    const settled = incoming('trf-1', 'SUCCESS', 'k-1');
    await cache.upsert({ ...settled, id: 'local-k-1', status: 'PENDING' });
    const sync = new EventSync(
      logApi([{ seq: 1, kind: 'TRANSACTION_SETTLED', transaction: settled, createdAt: 1 }]),
      cache,
      async () => undefined,
    );
    await sync.catchUp();
    expect((await cache.notifications(10)).map((n) => n.id)).toEqual(['evt-1']);
    expect(await cache.get('local-k-1')).toBeUndefined();
  });

  it('an event delivered twice is applied and delivered once', async () => {
    const cache = new CacheStore(nodeSqliteDriver());
    await cache.init();
    const tx = incoming('sim-000001');
    const sync = new EventSync(
      logApi([{ seq: 1, kind: 'MONEY_RECEIVED', transaction: tx, createdAt: 1 }], true),
      cache,
      async () => undefined,
    );
    const got: AppNotification[] = [];
    sync.subscribe((n) => got.push(...n));
    await sync.catchUp();
    await sync.catchUp();
    expect(got.map((n) => n.id)).toEqual(['evt-1']);
    expect(await cache.unreadCount()).toBe(1);
  });

  it('delivers newest first, pages through the log, and keeps the newest NOTIFICATIONS_KEPT', async () => {
    const cache = new CacheStore(nodeSqliteDriver());
    await cache.init();
    const log = Array.from({ length: 120 }, (_, i): WalletEvent => {
      const tx = incoming(`sim-${String(i + 1).padStart(6, '0')}`);
      return { seq: i + 1, kind: 'MONEY_RECEIVED', transaction: tx, createdAt: i };
    });
    const sync = new EventSync(logApi(log), cache, async () => undefined);
    const batches: string[][] = [];
    sync.subscribe((n) => batches.push(n.map((x) => x.id)));
    await sync.catchUp();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(120);
    expect(batches[0].slice(0, 2)).toEqual(['evt-120', 'evt-119']);
    const kept = await cache.notifications(NOTIFICATIONS_KEPT + 10);
    expect(kept.map((n) => n.id)).toEqual(Array.from({ length: NOTIFICATIONS_KEPT }, (_, i) => `evt-${120 - i}`));
    expect(await cache.eventCursor()).toBe(120);
  });

  it('a clear() meanwhile (logout) stops it without writing', async () => {
    const cache = new CacheStore(nodeSqliteDriver());
    await cache.init();
    const tx = incoming('sim-000001');
    let release!: () => void;
    let asked!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reading = new Promise<void>((r) => (asked = r));
    const api = logApi([{ seq: 1, kind: 'MONEY_RECEIVED', transaction: tx, createdAt: 1 }]);
    const slow: WalletApi = { ...api, getEvents: async (a, l) => (asked(), await gate, api.getEvents(a, l)) };
    const sync = new EventSync(slow, cache, async () => undefined);
    const got: AppNotification[] = [];
    sync.subscribe((n) => got.push(...n));
    const running = sync.catchUp();
    await reading;
    await cache.clear();
    release();
    await running;
    expect(got).toEqual([]);
    expect(await cache.get(tx.id)).toBeUndefined();
    expect(await cache.eventCursor()).toBe(0);
  });
});
