import {
  DEFAULT_DATASET,
  PENDING_RESOLVE_MAX_MS,
  TOP_UP_FEE_MINOR,
  TOP_UP_MAX_MINOR,
  TOP_UP_MIN_MINOR,
  TOP_UP_PRESETS_MINOR,
  TOP_UP_PROCESSING_MAX_MS,
  TOP_UP_PROCESSING_MIN_MS,
} from '@pocketly/core-contract';
import type { ErrorCode, NetworkSimulation, TopUpMethod, Transaction } from '@pocketly/core-contract';
import fixture from '@pocketly/core-contract/fixtures/topup.json';
import { FakeWalletApi } from '../src/data/fake/fakeWalletApi';
import { ServerStore } from '../src/data/fake/serverStore';
import { generateTransactions } from '../src/data/seedData';
import { UserTimeZone } from '../src/data/timeZone';
import { checkTopUpAmount, topUpCounterparty, topUpMethodOf } from '../src/domain/topUpPolicy';
import { isRetryable } from '../src/domain/transferPolicy';
import { nodeSqliteDriver } from '../testing/nodeSqliteDriver';

/** ADR-0015: the top-up rules and the fake server's endpoint, against fixtures/topup.json. */

const INSTANT: NetworkSimulation = {
  mode: 'NORMAL',
  failureRatePercent: 0,
  topUpProcessingMs: 0,
};
const METHODS: TopUpMethod[] = ['BANK_TRANSFER', 'CARD'];

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

describe('top-up rules (fixtures/topup.json)', () => {
  it('uses the parameters in the fixture', () => {
    const p = fixture.params;
    expect([p.minAmount, p.maxAmount, p.fee]).toEqual([TOP_UP_MIN_MINOR, TOP_UP_MAX_MINOR, TOP_UP_FEE_MINOR]);
    expect(p.presets).toEqual([...TOP_UP_PRESETS_MINOR]);
    expect([p.processingMinMs, p.processingMaxMs]).toEqual([TOP_UP_PROCESSING_MIN_MS, TOP_UP_PROCESSING_MAX_MS]);
  });

  it("each method's counterparty is the fixture's, and one the seed uses", () => {
    const seeded = generateTransactions(DEFAULT_DATASET, DEFAULT_DATASET.nowMillis!)
      .filter((t) => t.type === 'TOP_UP')
      .map((t) => JSON.stringify(t.counterparty));
    for (const method of METHODS) {
      const counterparty = topUpCounterparty(method);
      expect(counterparty).toEqual(fixture.methods[method]);
      expect(seeded).toContain(JSON.stringify(counterparty));
      expect(topUpMethodOf(counterparty)).toBe(method);
    }
    expect(topUpMethodOf({ kind: 'USER', id: 'pm-bank', name: 'Bank transfer' })).toBeUndefined();
  });

  it.each(fixture.amountCheck.cases)('amount "$input"', ({ input, expected }) => {
    expect(checkTopUpAmount(input)).toEqual(expected);
  });

  it('marks the codes retryable or not', () => {
    for (const [code, retryable] of Object.entries(fixture.retryable)) {
      if (code.startsWith('_')) continue;
      expect([code, isRetryable(code as ErrorCode)]).toEqual([code, retryable]);
    }
  });
});

describe('fake server: top-up (FR-TOP-02/03, ADR-0015 §4)', () => {
  it('walks fixtures/topup.json → server step by step', async () => {
    const api = await openServer();
    const usedBefore = (await api.getWallet()).usedToday;
    const results: (Transaction | undefined)[] = [];
    for (const [i, step] of fixture.server.steps.entries()) {
      api.network.set({
        ...INSTANT,
        declineTopUps: (step as { declineTopUps?: boolean }).declineTopUps ?? false,
      });
      const before = (await api.getWallet()).balance;
      let tx: Transaction | undefined;
      let code: ErrorCode | undefined;
      const s = step as {
        request?: { method: string; amount: number };
        transfer?: { recipientId: string; amount: number };
      };
      try {
        tx = s.transfer
          ? await api.transfer(s.transfer, step.key)
          : await api.topUp(
              {
                method: s.request!.method as TopUpMethod,
                amount: s.request!.amount,
              },
              step.key,
            );
      } catch (e) {
        code = (e as { code: ErrorCode }).code;
      }
      const expect_ = step.expect as {
        sameAs?: number;
        error?: string;
        status?: string;
        failureReason?: string;
        id?: string;
      };
      const label = `step ${i}`;
      if (expect_.error !== undefined) {
        expect([label, code]).toEqual([label, expect_.error]);
      } else if (expect_.sameAs !== undefined) {
        expect([label, tx]).toEqual([label, results[expect_.sameAs]]);
      } else {
        expect([label, tx?.status, tx?.failureReason, tx?.id]).toEqual([
          label,
          expect_.status,
          expect_.failureReason,
          expect_.id,
        ]);
        if (s.request) {
          const counterparty = fixture.methods[s.request.method as TopUpMethod];
          expect(tx).toMatchObject({
            idempotencyKey: step.key,
            type: 'TOP_UP',
            category: 'TOP_UP',
            amount: s.request.amount,
            counterparty,
          });
        }
      }
      results.push(tx);
      expect([label, (await api.getWallet()).balance - before]).toEqual([label, step.balanceDelta]);
    }
    expect(await api.getTransferByKey('k-1')).toEqual(results[0]);
    expect(await error(api.getTransferByKey('k-2'))).toBe('NOT_FOUND'); // refused requests aren't recorded
    // Only the transfer step counts toward the daily limit.
    expect((await api.getWallet()).usedToday).toBe(usedBefore + 1_000);
  });

  it('refuses an unknown method', async () => {
    const api = await openServer();
    expect(await error(api.topUp({ method: 'CASH' as TopUpMethod, amount: 1_000 }, 'cash'))).toBe('INVALID_ARGUMENT');
  });

  it('processing draws follow the seed (fixtures/topup.json → processing)', async () => {
    const api = await openServer();
    api.network.set(fixture.processing.simulation as NetworkSimulation);
    const drawn: number[] = [];
    for (let i = 0; i < fixture.processing.processingMs.length; i++) {
      const handling = await api.network.beforeTopUp();
      if (handling.kind === 'PROCESS') drawn.push(handling.processingMs);
    }
    expect(drawn).toEqual(fixture.processing.processingMs);
  });

  it('records the top-up PENDING on arrival and processes it outside the lock', async () => {
    const api = await openServer();
    const before = (await api.getWallet()).balance;
    api.network.set({ ...INSTANT, topUpProcessingMs: 150 });
    const answer = api.topUp({ method: 'CARD', amount: 2_500 }, 'slow');
    await tick();
    // Meanwhile the server answers other calls; the top-up is PENDING and not in the balance yet.
    expect((await api.getTransferByKey('slow')).status).toBe('PENDING');
    expect((await api.getWallet()).balance).toBe(before);
    // A retry while processing gets the PENDING row: no second charge.
    expect(await api.topUp({ method: 'CARD', amount: 2_500 }, 'slow')).toMatchObject({
      id: 'tup-1',
      status: 'PENDING',
    });
    const done = await answer;
    expect(done).toMatchObject({ id: 'tup-1', status: 'SUCCESS' });
    expect(await api.getTransferByKey('slow')).toEqual(done);
    expect((await api.getWallet()).balance).toBe(before + 2_500);
  });

  it('a declined top-up is recorded FAILED with PAYMENT_DECLINED', async () => {
    const api = await openServer();
    const before = (await api.getWallet()).balance;
    api.network.set({ ...INSTANT, declineTopUps: true });
    expect(await api.topUp({ method: 'BANK_TRANSFER', amount: 5_000 }, 'no')).toMatchObject({
      status: 'FAILED',
      failureReason: 'PAYMENT_DECLINED',
    });
    expect((await api.getWallet()).balance).toBe(before);
  });

  it('numbering restarts after reset, separately from transfers', async () => {
    const api = await openServer();
    await api.topUp({ method: 'CARD', amount: 1_000 }, 'a');
    await api.reset(DEFAULT_DATASET);
    expect((await api.topUp({ method: 'CARD', amount: 1_000 }, 'b')).id).toBe('tup-1');
    expect((await api.transfer({ recipientId: 'u-01', amount: 100 }, 'c')).id).toBe('trf-1');
  });
});

describe('fake server: top-up in TIMEOUT mode (FR-FAKE-05, ADR-0015 §4)', () => {
  const sets = [
    {
      label: 'normal',
      simulation: fixture.timeoutMode.simulation,
      holds: fixture.timeoutMode.holds,
    },
    {
      label: 'declined',
      simulation: fixture.timeoutMode.declined.simulation,
      holds: fixture.timeoutMode.declined.holds,
    },
  ];

  it.each(sets)('holds and settles with the seeded draws ($label)', async ({ simulation, holds }) => {
    const api = await openServer();
    for (const [i, expected] of holds.entries()) {
      api.network.set(simulation as NetworkSimulation);
      // Re-setting the simulation reseeds it, so skip the draws earlier top-ups made.
      for (let skip = 0; skip < i; skip++) await api.network.beforeTopUp();
      let answered = false;
      void api.topUp({ method: 'BANK_TRANSFER', amount: 1_000 }, `held-${i}`).then(() => (answered = true));
      await tick();
      expect(answered).toBe(false);
      api.network.set(INSTANT);
      expect((await api.getTransferByKey(`held-${i}`)).status).toBe('PENDING');
      api.advanceClock(expected.holdMs - 1);
      expect((await api.getTransferByKey(`held-${i}`)).status).toBe('PENDING');
      api.advanceClock(1);
      const done = await api.getTransferByKey(`held-${i}`);
      expect({
        holdMs: expected.holdMs,
        status: done.status,
        failureReason: done.failureReason,
      }).toEqual({
        failureReason: undefined,
        ...expected,
      });
    }
  });

  it('a declined top-up held across a restart settles declined (the reason is on disk)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pocketly-'));
    try {
      const path = join(dir, 'server.db');
      const first = await openServer(nodeSqliteDriver(path));
      first.network.set({
        mode: 'TIMEOUT',
        failureRatePercent: 0,
        declineTopUps: true,
      });
      void first.topUp({ method: 'CARD', amount: 900 }, 'across');
      await tick();
      const second = await openServer(nodeSqliteDriver(path));
      expect((await second.getTransferByKey('across')).status).toBe('PENDING');
      second.advanceClock(PENDING_RESOLVE_MAX_MS);
      expect(await second.getTransferByKey('across')).toMatchObject({
        status: 'FAILED',
        failureReason: 'PAYMENT_DECLINED',
      });
      expect((await second.topUp({ method: 'CARD', amount: 900 }, 'next')).id).toBe('tup-2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
