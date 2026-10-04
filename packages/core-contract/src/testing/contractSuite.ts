/**
 * BM-PAR-01: the contract test suite. Any `Core` implementation must pass it
 * before its benchmark numbers count.
 *
 * Expected values come from the JSON fixtures in `../../fixtures`:
 *  - money.json, state-machine.json, ingest.json are hand-written (source of truth)
 *  - golden.json is generated (`yarn contract:golden`) and checked in. The Kotlin
 *    side asserts against the very same files in `shared/src/jvmTest`.
 *
 * Uses Jest globals; never import this from app code.
 */
import { DEFAULT_DATASET } from '../constants';
import type { Core } from '../core';
import { CoreError } from '../errors';
import type { PriceTick, Transaction } from '../types';
import golden from '../../fixtures/golden.json';
import ingest from '../../fixtures/ingest.json';
import money from '../../fixtures/money.json';
import timeZones from '../../fixtures/time-zones.json';

type CoreFactory = () => Core | Promise<Core>;

async function expectCoreError(promise: Promise<unknown>, code: CoreError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
}

function expectCoreErrorSync(fn: () => unknown, code: CoreError['code']) {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toMatchObject({ code });
}

export async function readAllTransactions(core: Core, limit = 20): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let cursor: string | undefined;
  do {
    const page = await core.getTransactions(cursor, limit);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return all;
}

export function collectPriceBatches(
  core: Core,
  symbols: string[],
  batches: number,
  seed: number,
): Promise<PriceTick[][]> {
  return new Promise((resolve) => {
    const out: PriceTick[][] = [];
    const sub = core.subscribePrices(
      symbols,
      (ticks) => {
        if (out.length < batches) {
          out.push(ticks);
        }
        if (out.length === batches) {
          sub.unsubscribe();
          resolve(out);
        }
      },
      { intervalMs: 5, seed },
    );
  });
}

export function runContractSuite(name: string, createCore: CoreFactory): void {
  describe(`Core contract: ${name}`, () => {
    let core: Core;

    beforeEach(async () => {
      core = await createCore();
      core.setTimeZone('UTC');
      await core.resetData(DEFAULT_DATASET);
    });

    describe('money (NFR-MONEY-02)', () => {
      it.each(money.format)('formatMoney($minor) = $expected', ({ minor, expected }) => {
        expect(core.formatMoney(minor)).toBe(expected);
      });

      it('formatMoneyBatch matches formatMoney element-wise', () => {
        const minors = money.format.map((c) => c.minor);
        expect(core.formatMoneyBatch(minors)).toEqual(money.format.map((c) => c.expected));
      });

      it.each(money.formatInvalid)('formatMoney(%p) rejects non-safe-integer input', (minor) => {
        expectCoreErrorSync(() => core.formatMoney(minor), 'INVALID_ARGUMENT');
      });

      it.each(money.parse)('parseMoney($input)', ({ input, expected }) => {
        expect(core.parseMoney(input)).toEqual(expected);
      });
    });

    describe('fake backend dataset (FR-FAKE-01, BM-PAR-04)', () => {
      it('wallet matches golden', async () => {
        expect(await core.getWallet()).toEqual(golden.defaultDataset.wallet);
      });

      it('first page matches golden', async () => {
        expect(await core.getTransactions()).toEqual(golden.defaultDataset.firstPage);
      });

      it('pagination walks every transaction once, newest first (FR-HIST-01)', async () => {
        const all = await readAllTransactions(core, 17);
        expect(all.map((t) => t.id)).toEqual(golden.defaultDataset.allIds);
        for (let i = 1; i < all.length; i++) {
          expect(all[i - 1].createdAt).toBeGreaterThanOrEqual(all[i].createdAt);
        }
      });

      it('filters by status and type (FR-HIST-03)', async () => {
        const page = await core.getTransactions(undefined, 100, {
          statuses: ['PENDING', 'FAILED'],
          types: ['TRANSFER_OUT'],
        });
        expect(page.items.map((t) => t.id)).toEqual(golden.defaultDataset.pendingOrFailedTransferOutIds);
      });

      it('getTransaction returns the entity, or NOT_FOUND', async () => {
        const first = golden.defaultDataset.firstPage.items[0];
        expect(await core.getTransaction(first.id)).toEqual(first);
        await expectCoreError(core.getTransaction('nope'), 'NOT_FOUND');
      });

      it('rejects invalid page sizes and cursors', async () => {
        await expectCoreError(core.getTransactions(undefined, 0), 'INVALID_ARGUMENT');
        await expectCoreError(core.getTransactions(undefined, 101), 'INVALID_ARGUMENT');
        await expectCoreError(core.getTransactions('garbage'), 'INVALID_ARGUMENT');
      });
    });

    describe('computeSpendingSummary (BM-03)', () => {
      it.each(Object.keys(golden.summaries))('%s matches golden', async (month) => {
        expect(await core.computeSpendingSummary(month)).toEqual(
          golden.summaries[month as keyof typeof golden.summaries],
        );
        expect(core.lastComputeMs()).toBeGreaterThanOrEqual(0);
      });

      it('rejects malformed months', async () => {
        await expectCoreError(core.computeSpendingSummary('2026-13'), 'INVALID_ARGUMENT');
        await expectCoreError(core.computeSpendingSummary('Sept'), 'INVALID_ARGUMENT');
      });

      it('10k-entry benchmark dataset matches golden', async () => {
        await core.resetData(golden.largeDataset.config);
        expect(await core.getWallet()).toEqual(golden.largeDataset.wallet);
        expect(await core.computeSpendingSummary(golden.largeDataset.month)).toEqual(
          golden.largeDataset.summary,
        );
      });
    });

    describe('ingestTransactions (BM-04)', () => {
      it('validates, de-duplicates and applies entries', async () => {
        const before = await core.getWallet();
        expect(await core.ingestTransactions(JSON.stringify(ingest.input))).toEqual(ingest.expected);
        const after = await core.getWallet();
        expect(after.balance - before.balance).toBe(ingest.expectedBalanceDelta);
        expect((await core.getTransaction('ing-0001')).note).toBe('Iced latte');
      });

      it('is idempotent: re-ingesting the same payload only yields duplicates', async () => {
        await core.ingestTransactions(JSON.stringify(ingest.input));
        const second = await core.ingestTransactions(JSON.stringify(ingest.input));
        expect(second.accepted).toBe(0);
        expect(second.duplicates).toBe(ingest.expected.accepted + ingest.expected.duplicates);
      });

      it('rejects payloads that are not a JSON array', async () => {
        await expectCoreError(core.ingestTransactions('{not json'), 'INVALID_ARGUMENT');
        await expectCoreError(core.ingestTransactions('{"a":1}'), 'INVALID_ARGUMENT');
      });
    });

    describe('time zones (ADR-0006)', () => {
      it.each(timeZones.cases)('$name', async ({ zone, nowMillis, transactions, expected }) => {
        await core.resetData({ seed: 1, transactionCount: 1, nowMillis });
        core.setTimeZone(zone);
        const ingested = await core.ingestTransactions(JSON.stringify(transactions));
        expect(ingested.accepted).toBe(transactions.length);

        expect((await core.getWallet()).usedToday).toBe(expected.usedToday);
        for (const [month, want] of Object.entries(expected.months)) {
          const summary = await core.computeSpendingSummary(month);
          expect({
            totalSpent: summary.totalSpent,
            transactionCount: summary.transactionCount,
            byDay: summary.byDay.map((d) => [d.date, d.spent]),
          }).toEqual(want);
        }
      });

      it.each(timeZones.invalidZones)('rejects unknown zone %p', (zone) => {
        expectCoreErrorSync(() => core.setTimeZone(zone), 'INVALID_ARGUMENT');
      });

      it('a live (unfrozen) clock reports the current time', async () => {
        await core.resetData({ seed: 42, transactionCount: 10 });
        const before = Date.now();
        const wallet = await core.getWallet();
        expect(wallet.updatedAt).toBeGreaterThanOrEqual(before);
        expect(wallet.updatedAt).toBeLessThanOrEqual(Date.now());
      });
    });

    describe('subscribePrices (BM-05, NFR-ARCH-04)', () => {
      it('emits the golden deterministic tick sequence', async () => {
        const { symbols, seed, batches } = golden.prices;
        expect(await collectPriceBatches(core, symbols, batches.length, seed)).toEqual(batches);
      });
    });
  });
}
