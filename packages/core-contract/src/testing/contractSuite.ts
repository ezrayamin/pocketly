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
import {
  DEFAULT_AUTO_LOCK_MS,
  DEFAULT_DATASET,
  MAX_AUTO_LOCK_MS,
  NETWORK_NORMAL,
  PIN_HASH_BYTES,
  PIN_LOCKOUT_MS,
  PIN_MAX_ATTEMPTS,
  PIN_PBKDF2_ITERATIONS,
  PIN_RECORD_VERSION,
  PIN_SALT_BYTES,
} from '../constants';
import type { Core } from '../core';
import { CoreError } from '../errors';
import type { NetworkSimulation, PriceTick, Transaction, Wallet } from '../types';
import golden from '../../fixtures/golden.json';
import ingest from '../../fixtures/ingest.json';
import money from '../../fixtures/money.json';
import network from '../../fixtures/network.json';
import pin from '../../fixtures/pin.json';
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

      it('echo returns its argument (BM-06 call-cost probe)', () => {
        for (const v of [0, -1.5, 42, Number.MAX_SAFE_INTEGER]) expect(core.echo(v)).toBe(v);
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

      it('a row added at the top mid-scroll causes no duplicates or gaps (FR-HIST-01)', async () => {
        const seen: Transaction[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 3; page++) {
          const p = await core.getTransactions(cursor, 20);
          seen.push(...p.items);
          cursor = p.nextCursor;
        }
        const added = await core.simulateIncomingTransfer(); // newest: lands above page 1
        while (cursor !== undefined) {
          const p = await core.getTransactions(cursor, 20);
          seen.push(...p.items);
          cursor = p.nextCursor;
        }
        const ids = seen.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length); // no duplicates
        expect(ids).toEqual(golden.defaultDataset.allIds); // no gaps, same order
        expect(ids).not.toContain(added.id); // it's above where we started; a refresh shows it
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
      it('validates, de-duplicates and writes entries to the replica (not the server)', async () => {
        const before = await core.getWallet();
        expect(await core.ingestTransactions(JSON.stringify(ingest.input))).toEqual(ingest.expected);
        const after = await core.getWallet();
        expect(after.balance - before.balance).toBe(ingest.expectedBalanceDelta);
        expect((await core.getTransaction('ing-0001')).note).toBe('Iced latte');
        expect(core.lastStorageMs()).toBeGreaterThanOrEqual(0);
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

    describe('ingestStaged (BM-04b)', () => {
      it('throws INVALID_ARGUMENT when nothing is staged', async () => {
        await expectCoreError(core.ingestStaged(), 'INVALID_ARGUMENT');
      });

      it('ingests the staged payload exactly as ingestTransactions does, and keeps it staged', async () => {
        await core.stageIngestPayload(JSON.stringify(ingest.input));
        expect(await core.ingestStaged()).toEqual(ingest.expected);
        expect((await core.getTransaction('ing-0001')).note).toBe('Iced latte');
        const again = await core.ingestStaged();
        expect(again.accepted).toBe(0);
        expect(again.duplicates).toBe(ingest.expected.accepted + ingest.expected.duplicates);
      });

      it('survives resetData: the payload is the core\'s, not the database\'s', async () => {
        await core.stageIngestPayload(JSON.stringify(ingest.input));
        await core.resetData();
        expect(await core.ingestStaged()).toEqual(ingest.expected);
      });
    });

    describe('developer menu: network simulation (FR-DEV-02/03, FR-FAKE-04)', () => {
      it('starts NORMAL with no failures', () => {
        expect(core.getNetworkSimulation()).toEqual(network.defaultSimulation);
      });

      it.each(network.invalid)('rejects %j', (sim) => {
        expectCoreErrorSync(() => core.setNetworkSimulation(sim as NetworkSimulation), 'INVALID_ARGUMENT');
      });

      it.each(network.modeErrors)('$mode → $error: reads fall back to the replica, marked stale (FR-HIST-04)', async ({ mode, failureRatePercent, error }) => {
        const fresh = await core.getWallet();
        core.setNetworkSimulation({ mode: mode as NetworkSimulation['mode'], failureRatePercent });
        const wallet = await core.getWallet();
        expect(wallet.stale?.reason).toBe(error);
        expect({ ...wallet, stale: undefined }).toEqual({ ...fresh, stale: undefined });
        const page = await core.getTransactions();
        expect(page.stale?.reason).toBe(error);
        expect({ items: page.items, nextCursor: page.nextCursor }).toEqual(golden.defaultDataset.firstPage);
        // Later pages and local work never touch the server.
        await expect(core.getTransactions(page.nextCursor)).resolves.toBeDefined();
        await expect(core.computeSpendingSummary('2026-09')).resolves.toBeDefined();
      });

      it('with nothing cached yet, an unreachable server is an error', async () => {
        core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
        await core.resetData(DEFAULT_DATASET); // server re-seeded, replica cleared, sync fails
        await expectCoreError(core.getWallet(), 'NETWORK_UNAVAILABLE');
        await expectCoreError(core.getTransactions(), 'NETWORK_UNAVAILABLE');
      });

      it('the replica is separate from the server: offline shows what was synced, not live data', async () => {
        await core.getTransactions(); // synced
        await core.simulateIncomingTransfer(); // server-side change
        core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
        expect((await core.getTransactions()).items.map((t) => t.id)).not.toContain('sim-000001');
        core.setNetworkSimulation(NETWORK_NORMAL);
        expect((await core.getTransactions()).items[0].id).toBe('sim-000001'); // the next refresh brings it
      });

      it('failure rate follows the seeded golden sequence', async () => {
        const { simulation, outcomes } = golden.network;
        core.setNetworkSimulation(simulation as NetworkSimulation);
        const actual: string[] = [];
        for (let i = 0; i < outcomes.length; i++) {
          const wallet = await core.getWallet();
          actual.push(wallet.stale ? wallet.stale.reason : 'OK');
        }
        expect(actual).toEqual(outcomes);
      });

      it.each([
        ['response', 0],
        ['failure', 100],
      ])('a late %s (after the timeout) has no effect (ADR-0007)', async (_kind, failureRatePercent) => {
        const { simulation, waitAfterTimeoutMs } = network.lateResponse;
        const before = await core.getWallet();
        core.setNetworkSimulation({ ...(simulation as NetworkSimulation), failureRatePercent });

        const settlements: string[] = [];
        await core.getWallet().then(
          (w: Wallet) => settlements.push(w.stale ? `stale:${w.stale.reason}` : 'fresh'),
          (e: CoreError) => settlements.push(e.code),
        );
        expect(settlements).toEqual(['stale:NETWORK_TIMEOUT']); // answered from the replica

        // The backend answers during this wait. Nothing may settle again or change.
        await new Promise((r) => setTimeout(r, waitAfterTimeoutMs));
        expect(settlements).toEqual(['stale:NETWORK_TIMEOUT']);
        core.setNetworkSimulation(NETWORK_NORMAL);
        expect(await core.getWallet()).toEqual(before);
      });

      it('resetData keeps the simulation', async () => {
        core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
        await core.resetData(DEFAULT_DATASET);
        expect(core.getNetworkSimulation().mode).toBe('OFFLINE');
      });
    });

    describe('developer menu: incoming transfer (FR-DEV-04)', () => {
      it('adds deterministic incoming transfers, newest first, and updates the balance', async () => {
        const before = (await core.getWallet()).balance;
        const made = [await core.simulateIncomingTransfer(), await core.simulateIncomingTransfer()];
        expect(made.map((t) => ({ id: t.id, amount: t.amount, counterpartyId: t.counterparty?.id, counterpartyName: t.counterparty?.name }))).toEqual(network.incoming);
        expect(made.every((t) => t.type === 'TRANSFER_IN' && t.status === 'SUCCESS' && t.createdAt === DEFAULT_DATASET.nowMillis)).toBe(true);
        expect((await core.getWallet()).balance - before).toBe(network.incomingBalanceDelta);
        expect((await core.getTransactions(undefined, 2)).items.map((t) => t.id)).toEqual(['sim-000002', 'sim-000001']);
      });

      it('numbering restarts after resetData', async () => {
        await core.simulateIncomingTransfer();
        await core.resetData(DEFAULT_DATASET);
        expect((await core.simulateIncomingTransfer()).id).toBe('sim-000001');
      });
    });

    describe('time zones (ADR-0006)', () => {
      it.each(timeZones.cases)('$name', async ({ zone, nowMillis, transactions, expected }) => {
        core.setTimeZone(zone);
        await core.resetData({ seed: 1, transactionCount: 1, nowMillis, extraTransactions: transactions as Transaction[] });

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

    describe('PIN and lockout (FR-AUTH-03/05, FR-LOCK-01/04, ADR-0010)', () => {
      const GOOD = '482915';
      const OTHER = '731048';

      beforeEach(async () => {
        await core.resetAuth();
      });

      it('uses the parameters in fixtures/pin.json', () => {
        expect({
          iterations: PIN_PBKDF2_ITERATIONS,
          saltBytes: PIN_SALT_BYTES,
          hashBytes: PIN_HASH_BYTES,
          recordVersion: PIN_RECORD_VERSION,
          maxAttempts: PIN_MAX_ATTEMPTS,
          lockoutMs: PIN_LOCKOUT_MS,
        }).toEqual({ ...pin.params, algorithm: undefined });
      });

      it.each(pin.check)('checkPin($pin)', ({ pin: candidate, ok, reason }) => {
        expect(core.checkPin(candidate)).toEqual(ok ? { ok } : { ok, reason });
      });

      it('starts with no PIN, and verifying one is NOT_FOUND', async () => {
        expect(await core.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
        await expectCoreError(core.verifyPin(GOOD), 'NOT_FOUND');
      });

      it.each(['123456', '000000', '12345', '12a456'])('setPin(%p) is INVALID_ARGUMENT', async (bad) => {
        await expectCoreError(core.setPin(bad), 'INVALID_ARGUMENT');
        expect((await core.getAuthState()).pinSet).toBe(false);
      });

      it('unlocks with the right PIN only, counting wrong attempts until an unlock', async () => {
        await core.setPin(GOOD);
        expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0 });
        expect(await core.verifyPin(OTHER)).toEqual({ outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - 1 });
        expect(await core.verifyPin(OTHER)).toEqual({ outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - 2 });
        expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 2 });
        expect(await core.verifyPin(GOOD)).toEqual({ outcome: 'UNLOCKED', attemptsLeft: PIN_MAX_ATTEMPTS });
        expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0 });
      });

      it(`${PIN_MAX_ATTEMPTS} wrong PINs lock out for ${PIN_LOCKOUT_MS / 60_000} min, even for the right PIN`, async () => {
        await core.setPin(GOOD);
        for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
          expect((await core.verifyPin(OTHER)).outcome).toBe('WRONG_PIN');
        }
        const before = Date.now();
        const locked = await core.verifyPin(OTHER);
        expect(locked).toMatchObject({ outcome: 'LOCKED_OUT', attemptsLeft: 0 });
        expect(locked.lockedUntil).toBeGreaterThanOrEqual(before + PIN_LOCKOUT_MS);
        expect(locked.lockedUntil).toBeLessThanOrEqual(Date.now() + PIN_LOCKOUT_MS);

        expect(await core.verifyPin(GOOD)).toEqual(locked);
        expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0, lockedUntil: locked.lockedUntil });
      });

      it('setPin replaces the PIN and clears the counter', async () => {
        await core.setPin(GOOD);
        await core.verifyPin(GOOD.split('').reverse().join(''));
        await core.setPin(OTHER);
        expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0 });
        expect((await core.verifyPin(GOOD)).outcome).toBe('WRONG_PIN');
        expect((await core.verifyPin(OTHER)).outcome).toBe('UNLOCKED');
      });

      it('auto-lock timeout (FR-LOCK-02): default, valid range, kept by resetData, reset by resetAuth', async () => {
        expect([DEFAULT_AUTO_LOCK_MS, MAX_AUTO_LOCK_MS]).toEqual([pin.autoLock.defaultMs, pin.autoLock.maxMs]);
        expect(await core.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_MS);
        for (const ms of pin.autoLock.valid) {
          await core.setAutoLockTimeout(ms);
          expect(await core.getAutoLockTimeout()).toBe(ms);
        }
        for (const ms of pin.autoLock.invalid) {
          await expectCoreError(core.setAutoLockTimeout(ms), 'INVALID_ARGUMENT');
        }
        await core.setAutoLockTimeout(5000);
        await core.resetData(DEFAULT_DATASET);
        expect(await core.getAutoLockTimeout()).toBe(5000);
        await core.resetAuth();
        expect(await core.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_MS);
      });

      it('resetAuth deletes the PIN and the counter; resetData leaves them alone', async () => {
        await core.setPin(GOOD);
        await core.verifyPin(OTHER);
        await core.resetData(DEFAULT_DATASET);
        expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 1 });
        await core.resetAuth();
        expect(await core.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
      });
    });
  });
}
