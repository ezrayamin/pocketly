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
import { BM10_MAX_ITERATIONS } from '../benchConstants';
import {
  DEFAULT_DAILY_LIMIT_MINOR,
  PENDING_RESOLVE_MAX_MS,
  RECENT_CONTACTS_LIMIT,
  TRANSFER_MIN_MINOR,
  DEFAULT_AUTO_LOCK_MS,
  FAKE_OTP_CODE,
  OTP_COOLDOWN_MS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  PHONE_COUNTRY_CODE,
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  DEFAULT_DATASET,
  MAX_AUTO_LOCK_MS,
  NETWORK_NORMAL,
  PIN_HASH_BYTES,
  PIN_LOCKOUT_MS,
  PIN_MAX_ATTEMPTS,
  PIN_PBKDF2_ITERATIONS,
  PIN_RECORD_VERSION,
  PIN_SALT_BYTES,
  NOTIFICATIONS_KEPT,
  QR_MAX_LENGTH,
  TOP_UP_FEE_MINOR,
  TOP_UP_MAX_MINOR,
  TOP_UP_MIN_MINOR,
  TOP_UP_PRESETS_MINOR,
  TOP_UP_PROCESSING_MAX_MS,
  TOP_UP_PROCESSING_MIN_MS,
} from '../constants';
import type { BenchCore } from '../bench';
import type { Core } from '../core';
import { CoreError } from '../errors';
import type {
  AppNotification,
  Contact,
  DatasetConfig,
  NetworkSimulation,
  PriceTick,
  Transaction,
  TransferResult,
  Wallet,
} from '../types';
import golden from '../../fixtures/golden.json';
import eventsFixture from '../../fixtures/events.json';
import ingest from '../../fixtures/ingest.json';
import money from '../../fixtures/money.json';
import network from '../../fixtures/network.json';
import phoneFixture from '../../fixtures/phone.json';
import pin from '../../fixtures/pin.json';
import qrFixture from '../../fixtures/qr.json';
import { TEST_PHONE, verifyTestPhone } from './onboarding';
import timeZones from '../../fixtures/time-zones.json';
import topUpFixture from '../../fixtures/topup.json';
import transferFixture from '../../fixtures/transfer.json';

/** A core plus its benchmark-only entry points (perf builds; tests always have both). */
export interface CoreUnderTest {
  core: Core;
  bench: BenchCore;
  /** Test-only: resetData with extra rows seeded on the fake server (time-zone fixtures). */
  resetDataWithExtras(config: DatasetConfig, extraTransactions: Transaction[]): Promise<void>;
  /** Test-only: moves the fake server's frozen clock forward (held transfers settle by it). */
  advanceServerClock(ms: number): void;
  /** Test-only: the reads the core has made of the fake server since it was created (getWallet, getChanges, getEvents). */
  serverCalls(): readonly string[];
}

type CoreFactory = () => CoreUnderTest | Promise<CoreUnderTest>;

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
    let bench: BenchCore;
    let resetDataWithExtras: CoreUnderTest['resetDataWithExtras'];
    let advanceServerClock: CoreUnderTest['advanceServerClock'];

    beforeEach(async () => {
      ({ core, bench, resetDataWithExtras, advanceServerClock } = await createCore());
      core.setTimeZone('UTC');
      await core.resetData(DEFAULT_DATASET);
    });

    describe('money (NFR-MONEY-02)', () => {
      it.each(money.format)('formatMoney($minor) = $expected', ({ minor, expected }) => {
        expect(core.formatMoney(minor)).toBe(expected);
      });

      it('echo returns its argument (bench, BM-06 call-cost probe)', () => {
        for (const v of [0, -1.5, 42, Number.MAX_SAFE_INTEGER]) expect(bench.echo(v)).toBe(v);
      });

      it('formatMoneyBatch matches formatMoney element-wise (bench, BM-06)', () => {
        const minors = money.format.map((c) => c.minor);
        expect(bench.formatMoneyBatch(minors)).toEqual(money.format.map((c) => c.expected));
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
        expect(bench.lastComputeMs()).toBeGreaterThanOrEqual(0);
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

    describe('bench: ingestTransactions (BM-04)', () => {
      it('validates, de-duplicates and writes entries to the replica (not the server)', async () => {
        const before = await core.getWallet();
        expect(await bench.ingestTransactions(JSON.stringify(ingest.input))).toEqual(ingest.expected);
        const after = await core.getWallet();
        expect(after.balance - before.balance).toBe(ingest.expectedBalanceDelta);
        expect((await core.getTransaction('ing-0001')).note).toBe('Iced latte');
        expect(bench.lastStorageMs()).toBeGreaterThanOrEqual(0);
      });

      it('is idempotent: re-ingesting the same payload only yields duplicates', async () => {
        await bench.ingestTransactions(JSON.stringify(ingest.input));
        const second = await bench.ingestTransactions(JSON.stringify(ingest.input));
        expect(second.accepted).toBe(0);
        expect(second.duplicates).toBe(ingest.expected.accepted + ingest.expected.duplicates);
      });

      it('rejects payloads that are not a JSON array', async () => {
        await expectCoreError(bench.ingestTransactions('{not json'), 'INVALID_ARGUMENT');
        await expectCoreError(bench.ingestTransactions('{"a":1}'), 'INVALID_ARGUMENT');
      });
    });

    describe('bench: ingestStaged (BM-04b)', () => {
      it('throws INVALID_ARGUMENT when nothing is staged', async () => {
        await expectCoreError(bench.ingestStaged(), 'INVALID_ARGUMENT');
      });

      it('ingests the staged payload exactly as ingestTransactions does, and keeps it staged', async () => {
        await bench.stageIngestPayload(JSON.stringify(ingest.input));
        expect(await bench.ingestStaged()).toEqual(ingest.expected);
        expect((await core.getTransaction('ing-0001')).note).toBe('Iced latte');
        const again = await bench.ingestStaged();
        expect(again.accepted).toBe(0);
        expect(again.duplicates).toBe(ingest.expected.accepted + ingest.expected.duplicates);
      });

      it('survives resetData: the payload is the core\'s, not the database\'s', async () => {
        await bench.stageIngestPayload(JSON.stringify(ingest.input));
        await core.resetData();
        expect(await bench.ingestStaged()).toEqual(ingest.expected);
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
        core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
        await core.simulateIncomingTransfer(); // server-side change; its event can't reach the core offline
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
        await resetDataWithExtras({ seed: 1, transactionCount: 1, nowMillis }, transactions as Transaction[]);

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

    describe('phone and OTP (FR-AUTH-01/02, ADR-0013)', () => {
      const PHONE = TEST_PHONE;

      beforeEach(async () => {
        await core.resetAuth();
      });

      it('uses the parameters in fixtures/phone.json', () => {
        expect({
          countryCode: PHONE_COUNTRY_CODE,
          minDigits: PHONE_MIN_DIGITS,
          maxDigits: PHONE_MAX_DIGITS,
          otpLength: OTP_LENGTH,
          fakeCode: FAKE_OTP_CODE,
          maxAttempts: OTP_MAX_ATTEMPTS,
          cooldownMs: OTP_COOLDOWN_MS,
          resendMs: OTP_RESEND_MS,
          ttlMs: OTP_TTL_MS,
        }).toEqual(phoneFixture.params);
      });

      it.each(phoneFixture.check)('checkPhone($input)', ({ input, ok, e164, reason }) => {
        expect(core.checkPhone(input)).toEqual(ok ? { ok, e164 } : { ok, reason });
      });

      it('refuses numbers checkPhone refuses, and codes that aren\'t 6 digits', async () => {
        await expectCoreError(core.requestOtp('+62081234567890'), 'INVALID_ARGUMENT');
        await expectCoreError(core.requestOtp('081234567890'), 'INVALID_ARGUMENT');
        await expectCoreError(core.verifyOtp(PHONE, '12345'), 'INVALID_ARGUMENT');
      });

      it('no PIN before the phone is verified', async () => {
        await expectCoreError(core.setPin('482915'), 'NOT_FOUND');
        expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'NO_CODE' });
      });

      it('sends a code, refuses a resend within 30 s, and verifies the right code once', async () => {
        const sent = await core.requestOtp(PHONE);
        expect(sent.outcome).toBe('SENT');
        expect(await core.requestOtp(PHONE)).toEqual({ outcome: 'TOO_SOON', resendAt: sent.resendAt });
        expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'VERIFIED' });
        expect(await core.getAuthState()).toEqual({ phone: PHONE, pinSet: false, failedAttempts: 0 });
        expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'NO_CODE' }); // used up
        await core.setPin('482915');
        expect((await core.getAuthState()).pinSet).toBe(true);
      });

      it(`${OTP_MAX_ATTEMPTS} wrong codes start a cooldown that the right code doesn't skip`, async () => {
        await core.requestOtp(PHONE);
        expect(await core.verifyOtp(PHONE, '000000')).toEqual({ outcome: 'WRONG_CODE', attemptsLeft: 2 });
        expect(await core.verifyOtp(PHONE, '000000')).toEqual({ outcome: 'WRONG_CODE', attemptsLeft: 1 });
        const cooldown = await core.verifyOtp(PHONE, '000000');
        expect(cooldown.outcome).toBe('COOLDOWN');
        expect(cooldown.retryAt).toBeGreaterThan(Date.now() + OTP_COOLDOWN_MS - 5_000);
        expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual(cooldown);
        expect((await core.getAuthState()).phone).toBeUndefined();
      });

      it('resetAuth forgets the verified phone (onboarding starts over at the phone)', async () => {
        await verifyTestPhone(core);
        await core.resetAuth();
        expect((await core.getAuthState()).phone).toBeUndefined();
        await expectCoreError(core.setPin('482915'), 'NOT_FOUND');
      });
    });

    describe('PIN and lockout (FR-AUTH-03/05, FR-LOCK-01/04, ADR-0010)', () => {
      const GOOD = '482915';
      const OTHER = '731048';

      beforeEach(async () => {
        await core.resetAuth();
        await verifyTestPhone(core);
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
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: false, failedAttempts: 0 });
        await expectCoreError(core.verifyPin(GOOD), 'NOT_FOUND');
      });

      it.each(['123456', '000000', '12345', '12a456'])('setPin(%p) is INVALID_ARGUMENT', async (bad) => {
        await expectCoreError(core.setPin(bad), 'INVALID_ARGUMENT');
        expect((await core.getAuthState()).pinSet).toBe(false);
      });

      it('unlocks with the right PIN only, counting wrong attempts until an unlock', async () => {
        await core.setPin(GOOD);
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: true, failedAttempts: 0 });
        expect(await core.verifyPin(OTHER)).toEqual({ outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - 1 });
        expect(await core.verifyPin(OTHER)).toEqual({ outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - 2 });
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: true, failedAttempts: 2 });
        expect(await core.verifyPin(GOOD)).toEqual({ outcome: 'UNLOCKED', attemptsLeft: PIN_MAX_ATTEMPTS });
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: true, failedAttempts: 0 });
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
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: true, failedAttempts: 0, lockedUntil: locked.lockedUntil });
      });

      it('setPin replaces the PIN and clears the counter', async () => {
        await core.setPin(GOOD);
        await core.verifyPin(GOOD.split('').reverse().join(''));
        await core.setPin(OTHER);
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: true, failedAttempts: 0 });
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
        expect(await core.getAuthState()).toEqual({ phone: TEST_PHONE, pinSet: true, failedAttempts: 1 });
        await core.resetAuth();
        expect(await core.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 }); // the phone goes too
      });
    });

    describe('bench: pbkdf2WhatIf (BM-10, ADR-0010 §8)', () => {
      it.each(pin.pbkdf2)('matches fixtures/pin.json: $pin, $iterations iterations', async ({ pin: password, saltHex, iterations, hashHex }) => {
        expect(await bench.pbkdf2WhatIf(password, saltHex, iterations)).toBe(hashHex);
      }, 60_000);

      it.each([
        ['non-ASCII password', '４８２９１５', '00', 1],
        ['uppercase salt', '482915', 'AB', 1],
        ['odd-length salt', '482915', 'abc', 1],
        ['zero iterations', '482915', '00', 0],
        ['fractional iterations', '482915', '00', 1.5],
        ['too many iterations', '482915', '00', BM10_MAX_ITERATIONS + 1],
      ])('%s is INVALID_ARGUMENT', async (_name, password, saltHex, iterations) => {
        await expectCoreError(bench.pbkdf2WhatIf(password as string, saltHex as string, iterations as number), 'INVALID_ARGUMENT');
      });
    });

    describe('P2P transfer (F5, FR-TRF-01..11, ADR-0014)', () => {
      const PIN = '482915';
      const BAD_PIN = '159260';
      const START = golden.defaultDataset.wallet; // balance 1459085, usedToday 1578
      const DIRECTORY = transferFixture.directory as Contact[];
      const KEY = new RegExp(transferFixture.params.idempotencyKeyPattern);
      const pinAuth = { method: 'PIN' as const, pin: PIN };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const balance = async () => (await core.getWallet()).balance;

      async function reviewed(amount = 15_000, recipientId = 'u-01', note?: string) {
        await core.startTransfer(recipientId);
        return core.reviewTransfer(amount, note);
      }

      beforeEach(async () => {
        await core.resetAuth();
        await verifyTestPhone(core);
        await core.setPin(PIN);
      });

      describe('recipient (FR-TRF-01)', () => {
        it('lists recent recipients from history and the whole directory', async () => {
          const result = await core.searchContacts('');
          const history = await readAllTransactions(core, 100);
          const seen = new Set<string>();
          const recent: Contact[] = [];
          for (const tx of history) {
            const cp = tx.counterparty;
            if (tx.type !== 'TRANSFER_OUT' || !['SUCCESS', 'PENDING'].includes(tx.status) || cp?.kind !== 'USER' || seen.has(cp.id)) continue;
            seen.add(cp.id);
            recent.push({ userId: cp.id, name: cp.name, phone: cp.phone! });
          }
          expect(result.recent).toEqual(recent.slice(0, RECENT_CONTACTS_LIMIT));
          expect(result.contacts).toEqual(DIRECTORY);
          expect(result.phoneLookup).toBeUndefined();
        });

        it('searches by name or phone and tells a typed number apart', async () => {
          expect((await core.searchContacts('andi')).contacts.map((c) => c.userId)).toEqual(['u-01']);
          expect(await core.searchContacts('+62 812-3456-7781')).toEqual({ recent: [], contacts: [DIRECTORY[0]], phoneLookup: 'FOUND' });
          expect(await core.searchContacts('+62 899-0000-1234')).toEqual({ recent: [], contacts: [], phoneLookup: 'NOT_FOUND' });
          expect((await core.searchContacts('081234567890')).phoneLookup).toBe('SELF'); // TEST_PHONE
        });

        it('never offers, or sends to, this install\'s own phone', async () => {
          await core.resetAuth();
          await verifyTestPhone(core, DIRECTORY[0].phone); // this install is Andi
          const all = await core.searchContacts('');
          expect(all.contacts.map((c) => c.userId)).not.toContain('u-01');
          expect(all.recent.map((c) => c.userId)).not.toContain('u-01');
          expect((await core.searchContacts(DIRECTORY[0].phone)).phoneLookup).toBe('SELF');
          await expectCoreError(core.startTransfer('u-01'), 'INVALID_ARGUMENT');
        });

        it('an unknown recipient is RECIPIENT_NOT_FOUND', async () => {
          await expectCoreError(core.startTransfer('u-99'), 'RECIPIENT_NOT_FOUND');
        });

        it('offline, transfers can\'t start (FR-TRF-11)', async () => {
          await core.getWallet(); // cached, but a draft never uses the cache
          core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
          await expectCoreError(core.searchContacts(''), 'NETWORK_UNAVAILABLE');
          await expectCoreError(core.startTransfer('u-01'), 'NETWORK_UNAVAILABLE');
        });
      });

      describe('amount and review (FR-TRF-02/03/05/10)', () => {
        it('a draft carries fresh limits, and amounts are checked against them', async () => {
          expectCoreErrorSync(() => core.checkTransferAmount('10'), 'NOT_FOUND');
          const draft = await core.startTransfer('u-01');
          const remaining = DEFAULT_DAILY_LIMIT_MINOR - START.usedToday;
          expect(draft).toEqual({
            recipient: DIRECTORY[0],
            balance: START.balance,
            dailyRemaining: remaining,
            minAmount: TRANSFER_MIN_MINOR,
            maxAmount: remaining,
          });
          expect(core.checkTransferAmount('150')).toEqual({ ok: true, minor: 15_000, acceptInput: true, remainingBalance: START.balance - 15_000 });
          expect(core.checkTransferAmount('5000')).toMatchObject({ ok: false, reason: 'DAILY_LIMIT_EXCEEDED', acceptInput: true });
          expect(core.checkTransferAmount('1.234')).toEqual({ ok: false, reason: 'TOO_MANY_DECIMALS', acceptInput: false });
        });

        it('starting a transfer waits for one backend round trip, not two (calls in parallel)', async () => {
          await core.getAuthState();
          core.setNetworkSimulation({ ...NETWORK_NORMAL, normalLatencyMs: 200 });
          const started = Date.now();
          await core.startTransfer('u-01');
          expect(Date.now() - started).toBeLessThan(350); // sequential: ≥ 400
        });

        it('the developer menu\'s daily limit applies at the amount step (FR-TRF-10)', async () => {
          await core.setDailyLimit(10_000);
          const draft = await core.startTransfer('u-02');
          expect(draft.dailyRemaining).toBe(10_000 - START.usedToday);
          expect(core.checkTransferAmount('100')).toMatchObject({ ok: false, reason: 'DAILY_LIMIT_EXCEEDED' });
          await expectCoreError(core.setDailyLimit(-1), 'INVALID_ARGUMENT');
          await core.resetData(DEFAULT_DATASET);
          expect((await core.getWallet()).dailyLimit).toBe(DEFAULT_DAILY_LIMIT_MINOR);
        });

        it('review creates the attempt and its key; reviewing again makes a new one', async () => {
          const first = await reviewed(15_000, 'u-01', '  Dinner  ');
          expect(first).toEqual({
            id: first.idempotencyKey,
            idempotencyKey: first.idempotencyKey,
            recipient: DIRECTORY[0],
            amount: 15_000,
            fee: 0,
            note: 'Dinner',
            balanceAfter: START.balance - 15_000,
          });
          expect(first.idempotencyKey).toMatch(KEY);
          const second = await core.reviewTransfer(15_000);
          expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
          expect(second.note).toBeUndefined();
          expect(await balance()).toBe(START.balance); // nothing sent
        });

        it('review refuses what the amount step refuses', async () => {
          await core.startTransfer('u-01');
          await expectCoreError(core.reviewTransfer(99), 'INVALID_ARGUMENT');
          await expectCoreError(core.reviewTransfer(12.5), 'INVALID_ARGUMENT');
          await expectCoreError(core.reviewTransfer(START.balance + 1), 'INSUFFICIENT_FUNDS');
          await expectCoreError(core.reviewTransfer(DEFAULT_DAILY_LIMIT_MINOR), 'DAILY_LIMIT_EXCEEDED');
          await expectCoreError(core.reviewTransfer(1_000, 'two\nlines'), 'INVALID_ARGUMENT');
        });

        it('review needs a draft', async () => {
          await expectCoreError(core.reviewTransfer(1_000), 'NOT_FOUND');
        });
      });

      describe('confirm (FR-TRF-04..08)', () => {
        it('a wrong PIN sends nothing and counts; the right one sends once', async () => {
          const review = await reviewed(15_000, 'u-01', 'Dinner');
          const wrong = await core.confirmTransfer(review.id, { method: 'PIN', pin: BAD_PIN });
          expect(wrong).toEqual({ id: review.id, state: 'DRAFT', auth: 'WRONG_PIN', attemptsLeft: 4 });
          expect(await balance()).toBe(START.balance);

          const sent = await core.confirmTransfer(review.id, pinAuth);
          expect(sent).toMatchObject({ id: review.id, state: 'SUCCESS', auth: 'OK', balance: START.balance - 15_000 });
          expect(sent.transaction).toMatchObject({
            id: 'trf-1',
            idempotencyKey: review.idempotencyKey,
            type: 'TRANSFER_OUT',
            category: 'TRANSFER',
            amount: 15_000,
            counterparty: { kind: 'USER', id: 'u-01', name: 'Andi Pratama', phone: DIRECTORY[0].phone },
            note: 'Dinner',
            status: 'SUCCESS',
          });
          expect((await core.getAuthState()).failedAttempts).toBe(0);
          // FR-TRF-07: balance and history updated, and they agree with the server (NFR-MONEY-03).
          expect(await balance()).toBe(START.balance - 15_000);
          expect((await core.getTransactions()).items[0]).toEqual(sent.transaction);
          // Asking again changes nothing.
          expect(await core.confirmTransfer(review.id)).toEqual({ ...sent, auth: 'NOT_REQUIRED', balance: undefined });
          expect(await balance()).toBe(START.balance - 15_000);
        });

        it('a double tap gets one transfer (FR-TRF-05/06)', async () => {
          const review = await reviewed(2_000);
          core.setNetworkSimulation({ ...NETWORK_NORMAL, normalLatencyMs: 50 });
          const [a, b] = await Promise.all([core.confirmTransfer(review.id, pinAuth), core.confirmTransfer(review.id, pinAuth)]);
          expect(a).toEqual(b);
          expect(a.state).toBe('SUCCESS');
          expect(await balance()).toBe(START.balance - 2_000);
        });

        it('needs auth for a new attempt, and a known id', async () => {
          const review = await reviewed();
          await expectCoreError(core.confirmTransfer(review.id), 'INVALID_ARGUMENT');
          await expectCoreError(core.confirmTransfer('no-such-id', pinAuth), 'NOT_FOUND');
          expect(await balance()).toBe(START.balance);
        });

        it('Retry after a server error reuses the key and applies once (FR-TRF-08)', async () => {
          const review = await reviewed(3_000);
          core.setNetworkSimulation({ mode: 'ALWAYS_FAIL', failureRatePercent: 0 });
          const failed = await core.confirmTransfer(review.id, pinAuth);
          expect(failed).toMatchObject({ state: 'FAILED', auth: 'OK', failureReason: 'SERVER_ERROR', retryable: true });
          core.setNetworkSimulation(NETWORK_NORMAL);
          expect(await balance()).toBe(START.balance); // rolled back: nothing was applied
          const retried = await core.confirmTransfer(review.id);
          expect(retried).toMatchObject({ state: 'SUCCESS', auth: 'NOT_REQUIRED' });
          expect(retried.transaction!.idempotencyKey).toBe(review.idempotencyKey);
          expect(await balance()).toBe(START.balance - 3_000);
        });

        it('a refusal the server recorded is final: same answer, in history, balance unchanged', async () => {
          const review = await reviewed(5_000);
          await core.setDailyLimit(2_000); // lowered after the draft: the server refuses
          const failed = await core.confirmTransfer(review.id, pinAuth);
          expect(failed).toMatchObject({ state: 'FAILED', failureReason: 'DAILY_LIMIT_EXCEEDED', retryable: false });
          expect(failed.transaction).toMatchObject({ status: 'FAILED', failureReason: 'DAILY_LIMIT_EXCEEDED' });
          expect(await core.confirmTransfer(review.id)).toMatchObject({ state: 'FAILED', auth: 'NOT_REQUIRED', retryable: false });
          expect(await balance()).toBe(START.balance);
          expect((await core.getTransactions()).items[0]).toMatchObject({ id: failed.transaction!.id, status: 'FAILED' });
        });

        it('five wrong PINs lock out like the lock screen (FR-LOCK-04)', async () => {
          const review = await reviewed();
          let last: TransferResult | undefined;
          for (let i = 0; i < 5; i++) last = await core.confirmTransfer(review.id, { method: 'PIN', pin: BAD_PIN });
          expect(last).toMatchObject({ state: 'DRAFT', auth: 'PIN_LOCKED_OUT' });
          expect(last!.lockedUntil).toBeGreaterThan(0);
          expect((await core.confirmTransfer(review.id, pinAuth)).auth).toBe('PIN_LOCKED_OUT');
          expect(await balance()).toBe(START.balance);
        });
      });

      describe('timeouts (FR-TRF-09, ADR-0007, ADR-0014 §4)', () => {
        it('no answer within writeTimeoutMs: PENDING with a pending row, then the status check settles it', async () => {
          const review = await reviewed(4_000);
          await core.getWallet();
          core.setNetworkSimulation({ ...NETWORK_NORMAL, normalLatencyMs: 300, writeTimeoutMs: 100 });
          const pending = await core.confirmTransfer(review.id, pinAuth);
          expect(pending).toMatchObject({ state: 'PENDING', auth: 'OK', balance: START.balance - 4_000 });
          expect(pending.transaction).toMatchObject({ id: `local-${review.idempotencyKey}`, status: 'PENDING', amount: 4_000 });
          core.setNetworkSimulation({ ...NETWORK_NORMAL, readTimeoutMs: 100 });
          const offlinePage = await core.getTransactions(undefined, 20, { statuses: ['PENDING'] });
          expect(offlinePage.items.map((t) => t.idempotencyKey)).toContain(review.idempotencyKey);

          await wait(350); // the late answer arrives and is discarded; the server applied it
          const settled = await core.getTransferStatus(review.id);
          expect(settled).toMatchObject({ state: 'SUCCESS', auth: 'NOT_REQUIRED', balance: START.balance - 4_000 });
          expect(settled.transaction!.id).toBe('trf-1');
          const all = await readAllTransactions(core, 100);
          expect(all.filter((t) => t.idempotencyKey === review.idempotencyKey).map((t) => t.id)).toEqual(['trf-1']);
          expect(await balance()).toBe(START.balance - 4_000);
        });

        it('TIMEOUT mode: held by the server, settled later (FR-FAKE-05)', async () => {
          const review = await reviewed(6_000);
          core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100, readTimeoutMs: 100 });
          expect((await core.confirmTransfer(review.id, pinAuth)).state).toBe('PENDING');
          await expectCoreError(core.getTransferStatus(review.id), 'NETWORK_TIMEOUT'); // still unreachable
          core.setNetworkSimulation(NETWORK_NORMAL);
          const held = await core.getTransferStatus(review.id);
          expect(held.state).toBe('PENDING');
          expect(held.transaction).toMatchObject({ id: 'trf-1', status: 'PENDING' }); // the server's row now
          advanceServerClock(PENDING_RESOLVE_MAX_MS);
          expect((await core.getTransferStatus(review.id)).state).toBe('SUCCESS');
          expect(await balance()).toBe(START.balance - 6_000);
        });

        it('a held transfer that fails settles FAILED, not retryable, and the balance comes back', async () => {
          const review = await reviewed(6_000);
          core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 100, writeTimeoutMs: 100 });
          const pending = await core.confirmTransfer(review.id, pinAuth);
          expect(pending.state).toBe('PENDING');
          core.setNetworkSimulation(NETWORK_NORMAL);
          advanceServerClock(PENDING_RESOLVE_MAX_MS);
          const failed = await core.getTransferStatus(review.id);
          expect(failed).toMatchObject({ state: 'FAILED', failureReason: 'SERVER_ERROR', retryable: false, balance: START.balance });
          expect(await balance()).toBe(START.balance);
        });

        it('the status check finds nothing: FAILED, retryable, and a retry with the same key applies once', async () => {
          const review = await reviewed(7_000);
          core.setNetworkSimulation({ ...NETWORK_NORMAL, normalLatencyMs: 400, writeTimeoutMs: 100 });
          expect((await core.confirmTransfer(review.id, pinAuth)).state).toBe('PENDING');
          core.setNetworkSimulation(NETWORK_NORMAL);
          const notThere = await core.getTransferStatus(review.id); // the request is still on its way
          expect(notThere).toMatchObject({ state: 'FAILED', failureReason: 'NETWORK_TIMEOUT', retryable: true, balance: START.balance });
          await wait(400); // now it arrives and is applied
          const retried = await core.confirmTransfer(review.id);
          expect(retried).toMatchObject({ state: 'SUCCESS', auth: 'NOT_REQUIRED' });
          expect(await balance()).toBe(START.balance - 7_000); // once
        });
      });

      it('logout forgets every attempt', async () => {
        const review = await reviewed();
        await core.logout();
        await expectCoreError(core.confirmTransfer(review.id, pinAuth), 'NOT_FOUND');
        expectCoreErrorSync(() => core.checkTransferAmount('10'), 'NOT_FOUND');
      });
    });

    describe('Top-up (F6, FR-TOP-01..03, ADR-0015)', () => {
      const PIN = '482915';
      const START = golden.defaultDataset.wallet; // balance 1459085, usedToday 1578
      const KEY = new RegExp(topUpFixture.params.idempotencyKeyPattern);
      const BANK = topUpFixture.methods.BANK_TRANSFER;
      const CARD = topUpFixture.methods.CARD;
      /** No processing wait: tests that need one set topUpProcessingMs themselves. */
      const INSTANT: NetworkSimulation = { ...NETWORK_NORMAL, topUpProcessingMs: 0 };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const wallet = () => core.getWallet();
      const balance = async () => (await core.getWallet()).balance;

      beforeEach(async () => {
        await core.resetAuth();
        await verifyTestPhone(core);
        await core.setPin(PIN);
        core.setNetworkSimulation(INSTANT);
      });

      describe('amount (FR-TOP-01)', () => {
        it('the limits and presets are the fixture\'s', () => {
          const { params } = topUpFixture;
          expect([TOP_UP_MIN_MINOR, TOP_UP_MAX_MINOR, TOP_UP_FEE_MINOR]).toEqual([params.minAmount, params.maxAmount, params.fee]);
          expect([...TOP_UP_PRESETS_MINOR]).toEqual(params.presets);
          expect([TOP_UP_PROCESSING_MIN_MS, TOP_UP_PROCESSING_MAX_MS]).toEqual([params.processingMinMs, params.processingMaxMs]);
        });

        it.each(topUpFixture.amountCheck.cases)('checkTopUpAmount($input)', ({ input, expected }) => {
          expect(core.checkTopUpAmount(input)).toEqual(expected);
        });

        it('needs no draft and no server: works offline, and leaves a transfer\'s draft alone', async () => {
          core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
          expect(core.checkTopUpAmount('25')).toEqual({ ok: true, minor: 2_500, acceptInput: true });
          expectCoreErrorSync(() => core.checkTransferAmount('25'), 'NOT_FOUND');
        });

        it('every preset is a valid amount', () => {
          for (const preset of TOP_UP_PRESETS_MINOR) {
            expect(core.checkTopUpAmount(String(preset / 100))).toMatchObject({ ok: true, minor: preset });
          }
        });
      });

      describe('review (FR-TOP-01/02)', () => {
        it('creates the attempt and its key; reviewing again makes a new one', async () => {
          const first = await core.reviewTopUp(5_000, 'BANK_TRANSFER');
          expect(first).toEqual({
            id: first.idempotencyKey,
            idempotencyKey: first.idempotencyKey,
            method: 'BANK_TRANSFER',
            amount: 5_000,
            fee: 0,
            balanceAfter: START.balance + 5_000,
          });
          expect(first.idempotencyKey).toMatch(KEY);
          const second = await core.reviewTopUp(5_000, 'CARD');
          expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
          expect(second.method).toBe('CARD');
          expect(await balance()).toBe(START.balance); // nothing sent
        });

        it('refuses what the amount step refuses', async () => {
          await expectCoreError(core.reviewTopUp(TOP_UP_MIN_MINOR - 1, 'BANK_TRANSFER'), 'INVALID_ARGUMENT');
          await expectCoreError(core.reviewTopUp(TOP_UP_MAX_MINOR + 1, 'CARD'), 'INVALID_ARGUMENT');
          await expectCoreError(core.reviewTopUp(1_000.5, 'CARD'), 'INVALID_ARGUMENT');
          await expect(core.reviewTopUp(TOP_UP_MIN_MINOR, 'CARD')).resolves.toBeDefined();
          await expect(core.reviewTopUp(TOP_UP_MAX_MINOR, 'CARD')).resolves.toBeDefined();
        });

        it('has no daily limit and no balance cap (ADR-0015 §3)', async () => {
          await core.setDailyLimit(0);
          const review = await core.reviewTopUp(TOP_UP_MAX_MINOR, 'BANK_TRANSFER');
          expect((await core.confirmTransfer(review.id)).state).toBe('SUCCESS');
        });

        it('offline, top-ups can\'t start: the wallet is never read from the cache (FR-TRF-11)', async () => {
          await core.getWallet(); // cached
          core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
          await expectCoreError(core.reviewTopUp(5_000, 'BANK_TRANSFER'), 'NETWORK_UNAVAILABLE');
        });
      });

      describe('confirm (FR-TOP-03, ADR-0015 §2)', () => {
        it('needs no auth: adds the money once, to the balance and to history', async () => {
          const before = await wallet();
          const review = await core.reviewTopUp(5_000, 'BANK_TRANSFER');
          const done = await core.confirmTransfer(review.id);
          expect(done).toMatchObject({ id: review.id, state: 'SUCCESS', auth: 'NOT_REQUIRED', balance: START.balance + 5_000 });
          expect(done.transaction).toMatchObject({
            id: 'tup-1',
            idempotencyKey: review.idempotencyKey,
            type: 'TOP_UP',
            category: 'TOP_UP',
            amount: 5_000,
            counterparty: BANK,
            status: 'SUCCESS',
          });
          expect(done.transaction!.note).toBeUndefined();
          const after = await wallet();
          expect(after.balance).toBe(START.balance + 5_000);
          expect(after.usedToday).toBe(before.usedToday); // the daily limit counts money leaving only
          expect((await core.getTransactions()).items[0]).toEqual(done.transaction);
          // Asking again changes nothing.
          expect(await core.confirmTransfer(review.id)).toEqual({ ...done, balance: undefined });
          expect(await balance()).toBe(START.balance + 5_000);
        });

        it('a card top-up has the card as its counterparty', async () => {
          const review = await core.reviewTopUp(2_500, 'CARD');
          expect((await core.confirmTransfer(review.id)).transaction).toMatchObject({ id: 'tup-1', counterparty: CARD });
        });

        it('passing auth is INVALID_ARGUMENT, and sends nothing', async () => {
          const review = await core.reviewTopUp(5_000, 'BANK_TRANSFER');
          await expectCoreError(core.confirmTransfer(review.id, { method: 'PIN', pin: PIN }), 'INVALID_ARGUMENT');
          expect(await balance()).toBe(START.balance);
          expect((await core.getAuthState()).failedAttempts).toBe(0);
        });

        it('a double tap gets one top-up', async () => {
          const review = await core.reviewTopUp(2_000, 'CARD');
          core.setNetworkSimulation({ ...INSTANT, normalLatencyMs: 50 });
          const [a, b] = await Promise.all([core.confirmTransfer(review.id), core.confirmTransfer(review.id)]);
          expect(a).toEqual(b);
          expect(a.state).toBe('SUCCESS');
          expect(await balance()).toBe(START.balance + 2_000);
        });

        it('declined (developer menu): FAILED with PAYMENT_DECLINED, not retryable, in history', async () => {
          const review = await core.reviewTopUp(2_500, 'CARD');
          core.setNetworkSimulation({ ...INSTANT, declineTopUps: true });
          const declined = await core.confirmTransfer(review.id);
          expect(declined).toMatchObject({ state: 'FAILED', auth: 'NOT_REQUIRED', failureReason: 'PAYMENT_DECLINED', retryable: false, balance: START.balance });
          expect(declined.transaction).toMatchObject({ id: 'tup-1', status: 'FAILED', failureReason: 'PAYMENT_DECLINED' });
          core.setNetworkSimulation(INSTANT);
          expect(await core.confirmTransfer(review.id)).toMatchObject({ state: 'FAILED', failureReason: 'PAYMENT_DECLINED', retryable: false });
          expect(await balance()).toBe(START.balance);
          expect((await core.getTransactions()).items[0]).toMatchObject({ id: 'tup-1', status: 'FAILED' });
        });

        it('Retry after a server error reuses the key and applies once', async () => {
          const review = await core.reviewTopUp(3_000, 'BANK_TRANSFER');
          core.setNetworkSimulation({ mode: 'ALWAYS_FAIL', failureRatePercent: 0 });
          const failed = await core.confirmTransfer(review.id);
          expect(failed).toMatchObject({ state: 'FAILED', auth: 'NOT_REQUIRED', failureReason: 'SERVER_ERROR', retryable: true });
          core.setNetworkSimulation(INSTANT);
          expect(await balance()).toBe(START.balance);
          const retried = await core.confirmTransfer(review.id);
          expect(retried).toMatchObject({ state: 'SUCCESS', auth: 'NOT_REQUIRED' });
          expect(retried.transaction!.idempotencyKey).toBe(review.idempotencyKey);
          expect(await balance()).toBe(START.balance + 3_000);
        });

        it('top-ups and transfers are numbered separately, and a transfer still needs its PIN', async () => {
          const topUp = await core.reviewTopUp(5_000, 'BANK_TRANSFER');
          expect((await core.confirmTransfer(topUp.id)).transaction!.id).toBe('tup-1');
          await core.startTransfer('u-01');
          const transfer = await core.reviewTransfer(1_000);
          await expectCoreError(core.confirmTransfer(transfer.id), 'INVALID_ARGUMENT');
          expect((await core.confirmTransfer(transfer.id, { method: 'PIN', pin: PIN })).transaction!.id).toBe('trf-1');
          expect(await balance()).toBe(START.balance + 5_000 - 1_000);
        });
      });

      describe('processing and timeouts (FR-TOP-02/03, ADR-0015 §4)', () => {
        it('processing outlasts writeTimeoutMs: PENDING, not in the balance until the server settles it', async () => {
          const review = await core.reviewTopUp(4_000, 'CARD');
          await core.getWallet();
          core.setNetworkSimulation({ ...NETWORK_NORMAL, topUpProcessingMs: 300, writeTimeoutMs: 100 });
          const pending = await core.confirmTransfer(review.id);
          expect(pending).toMatchObject({ state: 'PENDING', auth: 'NOT_REQUIRED', balance: START.balance });
          expect(pending.transaction).toMatchObject({ id: `local-${review.idempotencyKey}`, status: 'PENDING', type: 'TOP_UP', amount: 4_000 });

          // Still processing: the server has it as PENDING, so the check doesn't start a second charge.
          const processing = await core.getTransferStatus(review.id);
          expect(processing.state).toBe('PENDING');
          expect(processing.transaction).toMatchObject({ id: 'tup-1', status: 'PENDING' });
          expect(await balance()).toBe(START.balance);

          await wait(350);
          const settled = await core.getTransferStatus(review.id);
          expect(settled).toMatchObject({ state: 'SUCCESS', auth: 'NOT_REQUIRED', balance: START.balance + 4_000 });
          expect(settled.transaction!.id).toBe('tup-1');
          const all = await readAllTransactions(core, 100);
          expect(all.filter((t) => t.idempotencyKey === review.idempotencyKey).map((t) => t.id)).toEqual(['tup-1']);
          expect(await balance()).toBe(START.balance + 4_000);
        });

        it('TIMEOUT mode: held by the server, settled later (FR-FAKE-05)', async () => {
          const review = await core.reviewTopUp(6_000, 'BANK_TRANSFER');
          core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100, readTimeoutMs: 100 });
          expect((await core.confirmTransfer(review.id)).state).toBe('PENDING');
          await expectCoreError(core.getTransferStatus(review.id), 'NETWORK_TIMEOUT');
          core.setNetworkSimulation(INSTANT);
          const held = await core.getTransferStatus(review.id);
          expect(held.state).toBe('PENDING');
          expect(held.transaction).toMatchObject({ id: 'tup-1', status: 'PENDING' });
          advanceServerClock(PENDING_RESOLVE_MAX_MS);
          expect((await core.getTransferStatus(review.id)).state).toBe('SUCCESS');
          expect(await balance()).toBe(START.balance + 6_000);
        });

        it('a held top-up keeps the decline it arrived with', async () => {
          const review = await core.reviewTopUp(6_000, 'CARD');
          core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100, declineTopUps: true });
          expect((await core.confirmTransfer(review.id)).state).toBe('PENDING');
          core.setNetworkSimulation(INSTANT); // decline off again: the held row already carries it
          advanceServerClock(PENDING_RESOLVE_MAX_MS);
          const failed = await core.getTransferStatus(review.id);
          expect(failed).toMatchObject({ state: 'FAILED', failureReason: 'PAYMENT_DECLINED', retryable: false, balance: START.balance });
          expect(await balance()).toBe(START.balance);
        });

        it('a held top-up that fails settles FAILED with SERVER_ERROR, not retryable', async () => {
          const review = await core.reviewTopUp(6_000, 'BANK_TRANSFER');
          core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 100, writeTimeoutMs: 100 });
          expect((await core.confirmTransfer(review.id)).state).toBe('PENDING');
          core.setNetworkSimulation(INSTANT);
          advanceServerClock(PENDING_RESOLVE_MAX_MS);
          expect(await core.getTransferStatus(review.id)).toMatchObject({ state: 'FAILED', failureReason: 'SERVER_ERROR', retryable: false, balance: START.balance });
        });
      });

      it('logout forgets every attempt', async () => {
        const review = await core.reviewTopUp(5_000, 'BANK_TRANSFER');
        await core.logout();
        await expectCoreError(core.confirmTransfer(review.id), 'NOT_FOUND');
      });
    });

    describe('QR Pay & My QR (F7, F8, FR-QR-01..05, ADR-0016)', () => {
      const PIN = '482915';
      const START = golden.defaultDataset.wallet; // balance 1459085, usedToday 1578
      const KEY = new RegExp(qrFixture.params.idempotencyKeyPattern);
      const CORNER_COFFEE = { kind: 'MERCHANT' as const, id: 'm-01', name: 'Corner Coffee' };
      const pinAuth = { method: 'PIN' as const, pin: PIN };
      const wallet = () => core.getWallet();
      const balance = async () => (await core.getWallet()).balance;
      const now = DEFAULT_DATASET.nowMillis!;
      const OFFLINE: NetworkSimulation = { mode: 'OFFLINE', failureRatePercent: 0 };

      beforeEach(async () => {
        await core.resetAuth();
        await verifyTestPhone(core);
        await core.setPin(PIN);
      });

      describe('parseQr (FR-QR-02)', () => {
        it.each(qrFixture.parse.cases)('parseQr($input)', ({ input, expected }) => {
          expect(core.parseQr(input)).toEqual(expected);
        });

        it.each(qrFixture.parse.tooLong.cases)('a $length-unit code is $reason', ({ length, reason }) => {
          const { prefix } = qrFixture.parse.tooLong;
          expect(core.parseQr(prefix + 'x'.repeat(length - prefix.length))).toEqual({ ok: false, reason });
        });

        it('needs no server, and the limit is the fixture\'s', () => {
          expect(QR_MAX_LENGTH).toBe(qrFixture.params.maxLength);
          core.setNetworkSimulation(OFFLINE);
          expect(core.parseQr('pocketly://pay/v1?m=m-01').ok).toBe(true);
        });
      });

      describe('paying a merchant (FR-QR-03/04)', () => {
        it('static code: the server names the merchant, the user types the amount, the PIN approves it', async () => {
          const before = await wallet();
          const draft = await core.startQrPayment('m-01');
          const remaining = DEFAULT_DAILY_LIMIT_MINOR - START.usedToday;
          expect(draft).toEqual({
            merchant: CORNER_COFFEE,
            balance: START.balance,
            dailyRemaining: remaining,
            minAmount: TRANSFER_MIN_MINOR,
            maxAmount: remaining,
          });
          expect(core.checkTransferAmount('12.5')).toMatchObject({ ok: true, minor: 1_250 });
          const review = await core.reviewQrPayment(1_250);
          expect(review).toEqual({
            id: review.idempotencyKey,
            idempotencyKey: review.idempotencyKey,
            merchant: CORNER_COFFEE,
            amount: 1_250,
            fee: 0,
            balanceAfter: START.balance - 1_250,
          });
          expect(review.idempotencyKey).toMatch(KEY);
          await expectCoreError(core.confirmTransfer(review.id), 'INVALID_ARGUMENT'); // money leaves: approval needed

          const paid = await core.confirmTransfer(review.id, pinAuth);
          expect(paid).toMatchObject({ state: 'SUCCESS', auth: 'OK', balance: START.balance - 1_250 });
          expect(paid.transaction).toMatchObject({
            id: 'qrp-1',
            idempotencyKey: review.idempotencyKey,
            type: 'QR_PAYMENT',
            category: 'FOOD',
            amount: 1_250,
            counterparty: CORNER_COFFEE,
            status: 'SUCCESS',
          });
          const after = await wallet();
          expect([after.balance, after.usedToday]).toEqual([before.balance - 1_250, before.usedToday + 1_250]);
          expect((await core.getTransactions()).items[0]).toEqual(paid.transaction);
        });

        it('dynamic code: the amount is the request\'s, locked, and the code pays once', async () => {
          const draft = await core.startQrPayment('m-01', 'pr-0001');
          expect(draft).toMatchObject({ merchant: CORNER_COFFEE, requestId: 'pr-0001', amount: 1_250, expiresAt: now + 31_536_000_000 });
          await expectCoreError(core.reviewQrPayment(1_000), 'INVALID_ARGUMENT');
          const review = await core.reviewQrPayment(1_250);
          expect(review.requestId).toBe('pr-0001');
          expect((await core.confirmTransfer(review.id, pinAuth)).state).toBe('SUCCESS');
          await expectCoreError(core.startQrPayment('m-01', 'pr-0001'), 'QR_ALREADY_PAID');
        });

        it('a refusal doesn\'t use up a dynamic code', async () => {
          const draft = await core.startQrPayment('m-05', 'pr-0004');
          expect(draft.amount).toBe(2_000_000);
          expect(draft.maxAmount).toBeLessThan(2_000_000);
          await expectCoreError(core.reviewQrPayment(2_000_000), 'INSUFFICIENT_FUNDS');
          await expect(core.startQrPayment('m-05', 'pr-0004')).resolves.toMatchObject({ requestId: 'pr-0004' });
        });

        it.each(qrFixture.lookup.cases.filter((c) => 'error' in c.expect))(
          'startQrPayment($merchantId, $requestId) is $expect.error',
          async ({ merchantId, requestId, expect: e }) => {
            await expectCoreError(core.startQrPayment(merchantId, requestId), (e as { error: CoreError['code'] }).error);
          },
        );

        it('offline, QR payments can\'t start (as FR-TRF-11)', async () => {
          await core.getWallet();
          core.setNetworkSimulation(OFFLINE);
          await expectCoreError(core.startQrPayment('m-01'), 'NETWORK_UNAVAILABLE');
        });

        it('one draft at a time: a QR payment replaces a transfer\'s, and the other way round', async () => {
          await core.startTransfer('u-01');
          await core.startQrPayment('m-03');
          await expectCoreError(core.reviewTransfer(1_000), 'NOT_FOUND');
          await core.startTransfer('u-01');
          await expectCoreError(core.reviewQrPayment(1_000), 'NOT_FOUND');
        });

        it('QR payments, transfers and top-ups are numbered separately', async () => {
          await core.startTransfer('u-01');
          const transfer = await core.reviewTransfer(1_000);
          expect((await core.confirmTransfer(transfer.id, pinAuth)).transaction!.id).toBe('trf-1');
          await core.startQrPayment('m-03');
          const qr = await core.reviewQrPayment(500);
          expect((await core.confirmTransfer(qr.id, pinAuth)).transaction!.id).toBe('qrp-1');
        });

        it('a held payment keeps the code paid; it settles like a transfer', async () => {
          await core.startQrPayment('m-01', 'pr-0001');
          const review = await core.reviewQrPayment(1_250);
          core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100 });
          const pending = await core.confirmTransfer(review.id, pinAuth);
          expect(pending).toMatchObject({ state: 'PENDING', balance: START.balance - 1_250 });
          core.setNetworkSimulation(NETWORK_NORMAL);
          await expectCoreError(core.startQrPayment('m-01', 'pr-0001'), 'QR_ALREADY_PAID');
          advanceServerClock(PENDING_RESOLVE_MAX_MS);
          expect((await core.getTransferStatus(review.id)).state).toBe('SUCCESS');
          expect(await balance()).toBe(START.balance - 1_250);
        });

        it('logout forgets every attempt and the draft', async () => {
          await core.startQrPayment('m-03');
          const review = await core.reviewQrPayment(500);
          await core.logout();
          await expectCoreError(core.confirmTransfer(review.id, pinAuth), 'NOT_FOUND');
          await expectCoreError(core.reviewQrPayment(500), 'NOT_FOUND');
        });
      });

      describe('My QR (FR-QR-05)', () => {
        const { payloadPrefix } = qrFixture.myQr;
        const USER_ID = new RegExp(qrFixture.myQr.userIdPattern);

        it('is this account\'s random user id, IDs only; scanning it is refused as yourself', async () => {
          const payload = await core.getMyQr();
          expect(payload.startsWith(payloadPrefix)).toBe(true);
          const userId = payload.slice(payloadPrefix.length);
          expect(userId).toMatch(USER_ID);
          expect(core.parseQr(payload)).toEqual({ ok: true, kind: 'USER', userId });
          await expectCoreError(core.startTransfer(userId), 'INVALID_ARGUMENT');
          await expect(core.startTransfer('u-01')).resolves.toBeDefined(); // another user's code: the Send flow
        });

        it('stays the same offline and after resetData; resetAuth forgets it', async () => {
          const payload = await core.getMyQr();
          core.setNetworkSimulation(OFFLINE);
          expect(await core.getMyQr()).toBe(payload);
          core.setNetworkSimulation(NETWORK_NORMAL);
          await core.resetData(DEFAULT_DATASET);
          expect(await core.getMyQr()).toBe(payload);
          await core.resetAuth();
          await expectCoreError(core.getMyQr(), 'NOT_FOUND'); // the same phone verified again keeps it: qrServer tests
        });
      });
    });

    describe('Notifications (F9, FR-NOTIF-01..03, ADR-0017)', () => {
      const PIN = '482915';
      const START = golden.defaultDataset.wallet; // balance 1459085
      const ID = new RegExp(eventsFixture.params.idPattern);
      const pinAuth = { method: 'PIN' as const, pin: PIN };
      const INSTANT: NetworkSimulation = { ...NETWORK_NORMAL, topUpProcessingMs: 0 };
      const OFFLINE: NetworkSimulation = { mode: 'OFFLINE', failureRatePercent: 0 };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      /** Delivery is asynchronous: polls until `check` holds (at most 3 s). */
      async function until(check: () => boolean | Promise<boolean>) {
        const end = Date.now() + 3_000;
        while (!(await check())) {
          if (Date.now() > end) throw new Error('timed out waiting for notifications');
          await wait(10);
        }
      }

      function subscribe() {
        const got: AppNotification[] = [];
        const sub = core.subscribeNotifications((n) => got.push(...n));
        return { got, sub };
      }

      beforeEach(async () => {
        await core.resetAuth();
        await verifyTestPhone(core);
        await core.setPin(PIN);
        core.setNetworkSimulation(INSTANT);
      });

      it('starts empty', async () => {
        expect(NOTIFICATIONS_KEPT).toBe(eventsFixture.params.kept);
        expect(await core.getNotifications()).toEqual({ items: [], unreadCount: 0 });
      });

      it('an incoming transfer notifies once, updates history, and reading clears the badge (FR-NOTIF-01/03)', async () => {
        const { got, sub } = subscribe();
        const tx = await core.simulateIncomingTransfer();
        await until(() => got.length === 1);
        expect(got[0]).toMatchObject({ kind: 'MONEY_RECEIVED', read: false, transaction: { id: tx.id, status: 'SUCCESS' } });
        expect(got[0].id).toMatch(ID);
        expect(await core.getNotifications()).toEqual({ items: [got[0]], unreadCount: 1 });
        core.setNetworkSimulation(OFFLINE); // the replica has it already
        expect((await core.getTransactions(undefined, 1)).items[0].id).toBe(tx.id);
        core.setNetworkSimulation(INSTANT);

        await core.markNotificationsRead();
        expect(await core.getNotifications()).toEqual({ items: [{ ...got[0], read: true }], unreadCount: 0 });
        await core.getTransactions(); // another catch-up: nothing new
        await wait(50);
        expect(got).toHaveLength(1);
        sub.unsubscribe();
      });

      it('a held transfer that settles notifies, and its attempt agrees without asking (FR-NOTIF-02)', async () => {
        await core.startTransfer('u-02');
        const review = await core.reviewTransfer(1_000);
        core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100 });
        expect((await core.confirmTransfer(review.id, pinAuth)).state).toBe('PENDING');
        core.setNetworkSimulation(INSTANT);
        const { got, sub } = subscribe();
        advanceServerClock(PENDING_RESOLVE_MAX_MS); // the server's timer settles it
        await until(() => got.length === 1);
        expect(got[0]).toMatchObject({
          kind: 'TRANSACTION_SETTLED',
          transaction: { id: 'trf-1', idempotencyKey: review.idempotencyKey, status: 'SUCCESS' },
        });
        core.setNetworkSimulation(OFFLINE); // no status check needed: the event moved the attempt
        expect(await core.getTransferStatus(review.id)).toMatchObject({ state: 'SUCCESS' });
        core.setNetworkSimulation(INSTANT);
        expect((await core.getWallet()).balance).toBe(START.balance - 1_000);
        sub.unsubscribe();
      });

      it('a top-up answered at once does not notify; one left pending does', async () => {
        const { got, sub } = subscribe();
        const quick = await core.reviewTopUp(5_000, 'BANK_TRANSFER');
        expect((await core.confirmTransfer(quick.id)).state).toBe('SUCCESS');
        await core.getTransactions(); // a catch-up that applies its settled event
        await wait(100);
        expect(got).toHaveLength(0);

        const slow = await core.reviewTopUp(2_500, 'CARD');
        core.setNetworkSimulation({ ...NETWORK_NORMAL, topUpProcessingMs: 300, writeTimeoutMs: 100 });
        expect((await core.confirmTransfer(slow.id)).state).toBe('PENDING');
        await until(() => got.length === 1);
        expect(got[0]).toMatchObject({ kind: 'TRANSACTION_SETTLED', transaction: { id: 'tup-2', status: 'SUCCESS' } });
        core.setNetworkSimulation(INSTANT);
        expect((await core.getWallet()).balance).toBe(START.balance + 5_000 + 2_500);
        sub.unsubscribe();
      });

      it('nothing is lost before subscribing: earlier events are in the list and the unread count', async () => {
        await core.simulateIncomingTransfer();
        await core.simulateIncomingTransfer();
        await core.getTransactions(); // a catch-up (Home's first load), with no one subscribed
        const list = await core.getNotifications();
        expect(list.unreadCount).toBe(2);
        expect(list.items.map((n) => n.transaction.id)).toEqual(['sim-000002', 'sim-000001']);
        const { got, sub } = subscribe();
        await core.getTransactions();
        await wait(50);
        expect(got).toHaveLength(0); // already in the list: not delivered again
        sub.unsubscribe();
      });

      it("a cold start reads nothing by itself; loading Home reads the event log once (ADR-0017 §2)", async () => {
        const fresh = await createCore(); // a cold start
        await fresh.core.getNotifications(); // local only: the databases are open
        await wait(50); // anything started in the background has had its chance
        expect(fresh.serverCalls()).toEqual([]); // nothing reads the server by itself at startup
        await Promise.all([fresh.core.getWallet(), fresh.core.getTransactions(undefined, 5)]);
        await wait(50);
        const calls = fresh.serverCalls();
        expect(calls.filter((c) => c === 'getEvents')).toHaveLength(1);
        expect(calls.filter((c) => c === 'getChanges')).toHaveLength(1);
      });

      it('keeps the newest 50 (FR-NOTIF-03)', async () => {
        for (let i = 0; i < NOTIFICATIONS_KEPT + 1; i++) await core.simulateIncomingTransfer();
        await until(async () => (await core.getNotifications()).items[0]?.transaction.id === 'sim-000051');
        const list = await core.getNotifications();
        expect(list.items).toHaveLength(NOTIFICATIONS_KEPT);
        expect(list.unreadCount).toBe(NOTIFICATIONS_KEPT);
        expect(list.items[NOTIFICATIONS_KEPT - 1].transaction.id).toBe('sim-000002'); // sim-000001 dropped
      });

      it('unsubscribing stops delivery, not the catching up', async () => {
        const { got, sub } = subscribe();
        sub.unsubscribe();
        await core.simulateIncomingTransfer();
        await until(async () => (await core.getNotifications()).unreadCount === 1);
        expect(got).toHaveLength(0);
      });

      it('works offline; resetData and logout clear them', async () => {
        await core.simulateIncomingTransfer();
        await until(async () => (await core.getNotifications()).unreadCount === 1);
        core.setNetworkSimulation(OFFLINE);
        expect((await core.getNotifications()).items).toHaveLength(1);
        core.setNetworkSimulation(INSTANT);
        await core.resetData(DEFAULT_DATASET);
        expect(await core.getNotifications()).toEqual({ items: [], unreadCount: 0 });
        await core.simulateIncomingTransfer();
        await until(async () => (await core.getNotifications()).unreadCount === 1);
        await core.logout();
        expect(await core.getNotifications()).toEqual({ items: [], unreadCount: 0 });
      });
    });

    describe('logout (NFR-SEC-05)', () => {
      const PIN = '482915';
      const OFFLINE: NetworkSimulation = { mode: 'OFFLINE', failureRatePercent: 0 };

      /** Nothing is cached: with the server out of reach, there is nothing to show. */
      async function expectReplicaEmpty() {
        core.setNetworkSimulation(OFFLINE);
        await expectCoreError(core.getWallet(), 'NETWORK_UNAVAILABLE');
        await expectCoreError(core.getTransactions(), 'NETWORK_UNAVAILABLE');
        expect((await core.computeSpendingSummary('2026-09')).transactionCount).toBe(0);
        core.setNetworkSimulation(NETWORK_NORMAL);
      }

      beforeEach(async () => {
        await core.resetAuth();
        await verifyTestPhone(core);
        await core.setPin(PIN);
        await core.getWallet();
        await core.getTransactions();
      });

      it('clears the replica and every secret; the server keeps the account', async () => {
        await core.setAutoLockTimeout(5000);
        await core.logout();
        expect(await core.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
        expect(await core.getAutoLockTimeout()).toBe(DEFAULT_AUTO_LOCK_MS);
        await expectReplicaEmpty();
        // The next sync starts from scratch.
        expect((await readAllTransactions(core)).map((t) => t.id)).toEqual(golden.defaultDataset.allIds);
      });

      it('a sync or fetch still in flight writes nothing afterwards', async () => {
        core.setNetworkSimulation({ ...NETWORK_NORMAL, normalLatencyMs: 200 });
        const page = core.getTransactions();
        const wallet = core.getWallet();
        await core.logout();
        // They still answer the caller; the cleared replica just isn't refilled.
        await expect(page).resolves.toMatchObject({ items: [] });
        await expect(wallet).resolves.toBeDefined();
        await expectReplicaEmpty();
      });

      it('the next person can onboard on the same install', async () => {
        const NEXT_PHONE = '+6285712345678';
        await core.logout();
        await expectCoreError(core.setPin(PIN), 'NOT_FOUND');
        await verifyTestPhone(core, NEXT_PHONE);
        await core.setPin('731048');
        expect(await core.getAuthState()).toEqual({ phone: NEXT_PHONE, pinSet: true, failedAttempts: 0 });
        expect((await core.verifyPin('731048')).outcome).toBe('UNLOCKED');
      });
    });
  });
}
