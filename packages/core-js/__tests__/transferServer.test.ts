import {
  DEFAULT_DAILY_LIMIT_MINOR,
  DEFAULT_DATASET,
  PENDING_RESOLVE_MAX_MS,
  PENDING_RESOLVE_MIN_MS,
  RECENT_CONTACTS_LIMIT,
  TRANSFER_FEE_MINOR,
  TRANSFER_MIN_MINOR,
  TRANSFER_NOTE_MAX_LENGTH,
  TRANSFER_TIMEOUT_MS,
} from '@pocketly/core-contract';
import type { ErrorCode, NetworkSimulation, Transaction } from '@pocketly/core-contract';
import fixture from '@pocketly/core-contract/fixtures/transfer.json';
import { searchDirectory } from '../src/data/contactSearch';
import { SERVER_SCHEMA, SERVER_VERSION } from '../src/data/db/sql.generated';
import { FakeWalletApi } from '../src/data/fake/fakeWalletApi';
import { ServerStore } from '../src/data/fake/serverStore';
import { CONTACTS } from '../src/data/seedData';
import { TimeoutWalletApi } from '../src/data/timeoutWalletApi';
import { UserTimeZone } from '../src/data/timeZone';
import type { TransferRequest } from '../src/data/walletApi';
import { checkTransferAmount, isRetryable, normalizeNote } from '../src/domain/transferPolicy';
import { nodeSqliteDriver } from '../testing/nodeSqliteDriver';

/** ADR-0014: the transfer rules and the fake server's endpoint, against fixtures/transfer.json. */

async function openServer(driver = nodeSqliteDriver()): Promise<FakeWalletApi> {
  const api = new FakeWalletApi(new ServerStore(driver), () => new UserTimeZone('UTC'));
  await api.open(DEFAULT_DATASET);
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

const request = (r: { recipientId: string; amount: number; note?: string }): TransferRequest =>
  r.note === undefined ? { recipientId: r.recipientId, amount: r.amount } : r;

describe('transfer rules (fixtures/transfer.json)', () => {
  it('uses the parameters in the fixture', () => {
    const p = fixture.params;
    expect(p.minAmount).toBe(TRANSFER_MIN_MINOR);
    expect(p.fee).toBe(TRANSFER_FEE_MINOR);
    expect(p.defaultDailyLimit).toBe(DEFAULT_DAILY_LIMIT_MINOR);
    expect(p.timeoutMs).toBe(TRANSFER_TIMEOUT_MS);
    expect(p.noteMaxLength).toBe(TRANSFER_NOTE_MAX_LENGTH);
    expect(p.recentLimit).toBe(RECENT_CONTACTS_LIMIT);
    expect(p.pendingResolveMinMs).toBe(PENDING_RESOLVE_MIN_MS);
    expect(p.pendingResolveMaxMs).toBe(PENDING_RESOLVE_MAX_MS);
  });

  it('the seed directory is the fixture directory', () => {
    expect(CONTACTS.map((c) => ({ userId: c.id, name: c.name, phone: c.phone }))).toEqual(fixture.directory);
  });

  it.each(fixture.search.cases)('search "$query"', (c) => {
    const result = searchDirectory(c.query, fixture.directory, fixture.search.selfPhone);
    expect(result.contacts.map((x) => x.userId)).toEqual(c.userIds);
    expect(result.phoneLookup).toBe((c as { phoneLookup?: string }).phoneLookup);
  });

  const amountSets = [fixture.amountCheck, fixture.amountCheck.fundsCases, fixture.amountCheck.equalCases];
  it.each(amountSets.flatMap((set) => set.cases.map((c) => ({ ...c, limits: set.limits }))))(
    'amount "$input" with $limits.balance / $limits.dailyRemaining',
    ({ input, limits, expected }) => {
      expect(checkTransferAmount(input, limits)).toEqual(expected);
    },
  );

  it('normalizes notes, and refuses long or multi-line ones', () => {
    for (const v of fixture.notes.valid) expect(normalizeNote(v.input)).toBe(v.note ?? undefined);
    for (const input of fixture.notes.invalid) expect(() => normalizeNote(input)).toThrow(/INVALID_ARGUMENT/);
    expect(normalizeNote(undefined)).toBeUndefined();
  });

  it('marks the §4.3 codes retryable or not', () => {
    for (const [code, retryable] of Object.entries(fixture.retryable)) {
      if (code.startsWith('_')) continue;
      expect([code, isRetryable(code as ErrorCode)]).toEqual([code, retryable]);
    }
  });
});

describe('fake server: transfer (FR-FAKE-02/03, FR-TRF-05, ADR-0014 §2)', () => {
  it('walks fixtures/transfer.json → server step by step', async () => {
    const api = await openServer();
    const results: (Transaction | undefined)[] = [];
    for (const [i, step] of fixture.server.steps.entries()) {
      const before = (await api.getWallet()).balance;
      let tx: Transaction | undefined;
      let code: ErrorCode | undefined;
      try {
        tx = await api.transfer(request(step.request), step.key);
      } catch (e) {
        code = (e as { code: ErrorCode }).code;
      }
      const expect_ = step.expect as { sameAs?: number; error?: string; status?: string; failureReason?: string; id?: string };
      const label = `step ${i}`;
      if (expect_.error !== undefined) {
        expect([label, code]).toEqual([label, expect_.error]);
      } else if (expect_.sameAs !== undefined) {
        expect([label, tx]).toEqual([label, results[expect_.sameAs]]);
      } else {
        expect([label, tx?.status, tx?.failureReason, tx?.id]).toEqual([label, expect_.status, expect_.failureReason, expect_.id]);
        expect(tx).toMatchObject({ idempotencyKey: step.key, type: 'TRANSFER_OUT', category: 'TRANSFER', amount: step.request.amount });
      }
      results.push(tx);
      expect([label, (await api.getWallet()).balance - before]).toEqual([label, step.balanceDelta]);
    }
    const sent = await api.getTransferByKey('k-1');
    expect(sent).toEqual(results[0]);
    expect(sent.counterparty).toEqual({ kind: 'USER', id: 'u-01', name: 'Andi Pratama', phone: '+6281234567781' });
    expect(await error(api.getTransferByKey('k-2'))).toBe('NOT_FOUND'); // refused requests aren't recorded
  });

  it('applies a key once even when the same request arrives twice at the same time', async () => {
    const api = await openServer();
    const before = (await api.getWallet()).balance;
    const req = { recipientId: 'u-04', amount: 2_500 };
    const [a, b] = await Promise.all([api.transfer(req, 'twice'), api.transfer(req, 'twice')]);
    expect(a).toEqual(b);
    expect((await api.getWallet()).balance).toBe(before - 2_500);
  });

  it('a simulated server error or offline applies nothing, so the same key works afterwards', async () => {
    const api = await openServer();
    const before = (await api.getWallet()).balance;
    const req = { recipientId: 'u-05', amount: 1_000 };
    api.network.set({ mode: 'ALWAYS_FAIL', failureRatePercent: 0 });
    expect(await error(api.transfer(req, 'retry-me'))).toBe('SERVER_ERROR');
    api.network.set({ mode: 'OFFLINE', failureRatePercent: 0 });
    expect(await error(api.transfer(req, 'retry-me'))).toBe('NETWORK_UNAVAILABLE');
    api.network.set({ mode: 'NORMAL', failureRatePercent: 0 });
    expect(await error(api.getTransferByKey('retry-me'))).toBe('NOT_FOUND');
    expect((await api.transfer(req, 'retry-me')).status).toBe('SUCCESS');
    expect((await api.getWallet()).balance).toBe(before - 1_000);
  });

  it('a request still on its way when the client gives up is applied anyway (ADR-0007 §2)', async () => {
    const api = await openServer();
    const client = new TimeoutWalletApi(api, (kind) => (kind === 'write' ? 20 : 1_000));
    api.network.set({ mode: 'NORMAL', failureRatePercent: 0, normalLatencyMs: 60 });
    expect(await error(client.transfer({ recipientId: 'u-06', amount: 700 }, 'slow'))).toBe('NETWORK_TIMEOUT');
    await new Promise((r) => setTimeout(r, 100));
    api.network.set({ mode: 'NORMAL', failureRatePercent: 0 });
    expect((await client.getTransferByKey('slow')).status).toBe('SUCCESS');
  });

  it('the daily limit is the server\'s, changeable, and restored by reset (FR-TRF-10)', async () => {
    const api = await openServer();
    expect((await api.getWallet()).dailyLimit).toBe(DEFAULT_DAILY_LIMIT_MINOR);
    await api.setDailyLimit(2_000);
    expect((await api.getWallet()).dailyLimit).toBe(2_000);
    const refused = await api.transfer({ recipientId: 'u-01', amount: 500 }, 'over'); // 1578 used already
    expect([refused.status, refused.failureReason]).toEqual(['FAILED', 'DAILY_LIMIT_EXCEEDED']);
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER]) expect(await error(api.setDailyLimit(bad))).toBe('INVALID_ARGUMENT');
    await api.reset(DEFAULT_DATASET);
    expect((await api.getWallet()).dailyLimit).toBe(DEFAULT_DAILY_LIMIT_MINOR);
    expect((await api.transfer({ recipientId: 'u-01', amount: 500 }, 'k')).id).toBe('trf-1'); // numbering restarts
  });

  it('refuses a transfer to the account\'s own phone, also after a data reset (ADR-0014 §6)', async () => {
    const api = await openServer();
    const andi = fixture.directory[0].phone;
    await api.requestOtp(andi);
    expect((await api.verifyOtp(andi, '123456')).outcome).toBe('VERIFIED');
    expect(await error(api.transfer({ recipientId: 'u-01', amount: 500 }, 'self'))).toBe('INVALID_ARGUMENT');
    expect(await error(api.getTransferByKey('self'))).toBe('NOT_FOUND'); // nothing recorded
    await api.reset(DEFAULT_DATASET);
    expect(await error(api.transfer({ recipientId: 'u-01', amount: 500 }, 'self-2'))).toBe('INVALID_ARGUMENT');
    expect((await api.transfer({ recipientId: 'u-02', amount: 500 }, 'other')).status).toBe('SUCCESS');
  });

  it('searches the directory by name or phone', async () => {
    const api = await openServer();
    expect((await api.searchContacts('dewi')).map((c) => c.userId)).toEqual(['u-04']);
    expect(await api.searchContacts('')).toHaveLength(10);
  });
});

describe('fake server: TIMEOUT mode (FR-FAKE-05)', () => {
  const settle = async (api: FakeWalletApi, key: string) => {
    api.network.set({ mode: 'NORMAL', failureRatePercent: 0 });
    return api.getTransferByKey(key);
  };

  it('records the transfer PENDING, never answers, then settles with the seeded draws', async () => {
    const api = await openServer();
    const before = (await api.getWallet()).balance;
    const outcomes: { holdMs: number; fails: boolean }[] = [];
    for (const [i, expected] of fixture.timeoutMode.holds.entries()) {
      api.network.set(fixture.timeoutMode.simulation as NetworkSimulation);
      // Re-setting the simulation reseeds it, so skip the draws earlier transfers made.
      for (let skip = 0; skip < i; skip++) await api.network.beforeTransfer();
      let answered = false;
      void api.transfer({ recipientId: 'u-02', amount: 1_000 }, `held-${i}`).then(() => (answered = true));
      await new Promise((r) => setTimeout(r, 10));
      expect(answered).toBe(false);

      const held = await settle(api, `held-${i}`);
      expect(held.status).toBe('PENDING');
      api.advanceClock(expected.holdMs - 1);
      expect((await api.getTransferByKey(`held-${i}`)).status).toBe('PENDING');
      api.advanceClock(1);
      const done = await api.getTransferByKey(`held-${i}`);
      expect(done.updatedAt).toBeGreaterThan(held.updatedAt);
      outcomes.push({ holdMs: expected.holdMs, fails: done.status === 'FAILED' });
      if (done.status === 'FAILED') expect(done.failureReason).toBe('SERVER_ERROR');
    }
    expect(outcomes).toEqual(fixture.timeoutMode.holds);
    const succeeded = fixture.timeoutMode.holds.filter((h) => !h.fails).length;
    expect((await api.getWallet()).balance).toBe(before - succeeded * 1_000);
  });

  it('a held transfer counts against the balance and the daily limit until it settles', async () => {
    const api = await openServer();
    const wallet = await api.getWallet();
    api.network.set({ mode: 'TIMEOUT', failureRatePercent: 100 });
    void api.transfer({ recipientId: 'u-02', amount: 4_000 }, 'held');
    await new Promise((r) => setTimeout(r, 10));
    const held = await settle(api, 'held');
    expect(held.status).toBe('PENDING');
    expect(await api.getWallet()).toMatchObject({ balance: wallet.balance - 4_000, usedToday: wallet.usedToday + 4_000 });
    api.advanceClock(PENDING_RESOLVE_MAX_MS);
    expect((await api.getTransferByKey('held')).status).toBe('FAILED');
    expect(await api.getWallet()).toMatchObject({ balance: wallet.balance, usedToday: wallet.usedToday });
  });

  it('settles on the next start after a restart (state is on disk)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pocketly-'));
    try {
      const path = join(dir, 'server.db');
      const first = await openServer(nodeSqliteDriver(path));
      first.network.set({ mode: 'TIMEOUT', failureRatePercent: 0 });
      void first.transfer({ recipientId: 'u-03', amount: 900 }, 'across');
      await new Promise((r) => setTimeout(r, 10));
      const second = await openServer(nodeSqliteDriver(path));
      expect((await second.getTransferByKey('across')).status).toBe('PENDING');
      second.advanceClock(PENDING_RESOLVE_MAX_MS);
      expect((await second.getTransferByKey('across')).status).toBe('SUCCESS');
      expect((await second.transfer({ recipientId: 'u-03', amount: 900 }, 'next')).id).toBe('trf-2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('server schema migration (1 → 2)', () => {
  it('adds the transfer tables to a version-1 database and keeps its data', async () => {
    const driver = nodeSqliteDriver();
    // A slice-5 database: version 1, without the tables 1.sqm adds.
    for (const statement of SERVER_SCHEMA.filter((s) => !/server_transfer_key|server_pending_settlement/.test(s))) {
      await driver.exec(statement);
    }
    await driver.exec('PRAGMA user_version = 1');
    await driver.run("INSERT INTO server_meta(key, value) VALUES ('seeded', '1')", []);
    await driver.run("INSERT INTO server_meta(key, value) VALUES ('frozenNowMillis', ?)", [String(DEFAULT_DATASET.nowMillis)]);

    const api = await openServer(driver);
    const [row] = await driver.query('PRAGMA user_version', []);
    expect(Number(row.user_version)).toBe(SERVER_VERSION);
    expect(SERVER_VERSION).toBe(2);
    expect((await api.transfer({ recipientId: 'u-01', amount: 100 }, 'after-migration')).status).toBe('FAILED'); // empty ledger
  });
});
