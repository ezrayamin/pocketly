import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DATASET, NETWORK_NORMAL } from '@pocketly/core-contract';
import type { Core } from '@pocketly/core-contract';
import { verifyTestPhone } from '@pocketly/core-contract/src/testing/onboarding';
import transfer from '@pocketly/core-contract/fixtures/transfer.json';
import { transferMessage } from '../src/security/biometricMessages';
import { uuidV4 } from '../src/sync/transferFlow';
import { MemorySecureStore } from '../src/security/secureStore';
import { FakeBiometricSigner } from '../testing/fakeBiometricSigner';
import { testCore } from '../testing/testCore';

/**
 * ADR-0014 §3 (biometric confirmation) and NFR-REL-03 (restart while PENDING): the parts the
 * contract suite can't script. Same cases as shared/src/jvmTest/.../contract/TransferFlowTest.kt.
 */
const PIN = '482915';
const PROMPT = { title: 'Confirm transfer', subtitle: 'Send $150.00 to Andi Pratama', cancel: 'Use PIN' };
const BIOMETRIC = { method: 'BIOMETRIC' as const, prompt: PROMPT };

describe('idempotency keys', () => {
  it('are RFC 4122 version 4', () => {
    const key = uuidV4(new Uint8Array(16).fill(0xff));
    expect(key).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(key).toMatch(new RegExp(transfer.params.idempotencyKeyPattern));
    expect(uuidV4(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('biometric confirmation (FR-TRF-04, ADR-0012)', () => {
  let signer: FakeBiometricSigner;
  let core: Core;

  beforeEach(async () => {
    signer = new FakeBiometricSigner();
    core = testCore({ biometrics: signer, pinIterations: 1000 });
    await core.resetData(DEFAULT_DATASET);
    await verifyTestPhone(core);
    await core.setPin(PIN);
    expect((await core.enableBiometrics(PIN, PROMPT)).outcome).toBe('ENABLED');
  });

  const review = async () => {
    await core.startTransfer('u-01');
    return core.reviewTransfer(15_000, 'Dinner');
  };

  it('signs exactly this attempt\'s transfer message, then sends', async () => {
    const r = await review();
    const result = await core.confirmTransfer(r.id, BIOMETRIC);
    expect(result).toMatchObject({ state: 'SUCCESS', auth: 'OK' });
    expect(signer.messages.at(-1)).toBe(transferMessage({ amount: 15_000, recipientId: 'u-01', idempotencyKey: r.idempotencyKey }));
    expect(signer.prompts.at(-1)).toEqual(PROMPT);
  });

  it('cancel returns to review with nothing sent; the PIN still works after', async () => {
    const r = await review();
    signer.scans.push('CANCEL');
    expect(await core.confirmTransfer(r.id, BIOMETRIC)).toEqual({ id: r.id, state: 'DRAFT', auth: 'CANCELLED' });
    expect((await core.getWallet()).balance).toBe(1_459_085);
    expect((await core.confirmTransfer(r.id, { method: 'PIN', pin: PIN })).state).toBe('SUCCESS');
  });

  it('a biometric lockout or a busy sensor changes nothing', async () => {
    const r = await review();
    signer.scans.push('LOCKOUT', 'DEVICE_LOCKED');
    expect((await core.confirmTransfer(r.id, BIOMETRIC)).auth).toBe('BIOMETRIC_LOCKED_OUT');
    expect((await core.confirmTransfer(r.id, BIOMETRIC)).auth).toBe('UNAVAILABLE');
    expect((await core.getBiometricStatus()).enabled).toBe(true);
  });

  it.each([
    ['INVALIDATED', 'KEY_INVALIDATED'],
    ['OTHER_KEY', 'FAILED'],
  ] as const)('a %s scan turns biometrics off (%s) and sends nothing', async (scan, outcome) => {
    const r = await review();
    signer.scans.push(scan);
    expect(await core.confirmTransfer(r.id, BIOMETRIC)).toEqual({ id: r.id, state: 'DRAFT', auth: outcome });
    expect((await core.getBiometricStatus()).enabled).toBe(false);
    await expect(core.confirmTransfer(r.id, BIOMETRIC)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await core.getWallet()).balance).toBe(1_459_085);
  });

  it('an unlock signature can\'t approve a transfer', async () => {
    expect((await core.unlockWithBiometrics(PROMPT)).outcome).toBe('UNLOCKED');
    const r = await review();
    signer.scans.push('REPLAY'); // the unlock's signature, presented for the transfer
    expect((await core.confirmTransfer(r.id, BIOMETRIC)).auth).toBe('FAILED');
  });

  it('a double tap shows one prompt', async () => {
    const r = await review();
    const before = signer.prompts.length;
    const [a, b] = await Promise.all([core.confirmTransfer(r.id, BIOMETRIC), core.confirmTransfer(r.id, BIOMETRIC)]);
    expect(a).toEqual(b);
    expect(signer.prompts.length - before).toBe(1);
  });
});

describe('restart while PENDING (NFR-REL-03)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketly-'));
  const files = { serverPath: join(dir, 'server.db'), cachePath: join(dir, 'cache.db') };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('the pending row is still there, and its key settles it after the restart', async () => {
    const first = testCore({ ...files, dataset: DEFAULT_DATASET, pinIterations: 1000 });
    await first.resetData(DEFAULT_DATASET);
    await verifyTestPhone(first);
    await first.setPin(PIN);
    await first.startTransfer('u-03');
    const r = await first.reviewTransfer(8_000);
    first.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0, writeTimeoutMs: 100 });
    expect((await first.confirmTransfer(r.id, { method: 'PIN', pin: PIN })).state).toBe('PENDING');

    const second = testCore({ ...files, dataset: DEFAULT_DATASET, pinIterations: 1000 });
    second.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    const offline = await second.getTransactions(undefined, 20, { statuses: ['PENDING'] });
    expect(offline.items.find((t) => t.idempotencyKey === r.idempotencyKey)).toMatchObject({ id: `local-${r.idempotencyKey}` });

    second.setNetworkSimulation(NETWORK_NORMAL);
    expect((await second.getTransferStatus(r.id)).state).toBe('PENDING');
    (second as unknown as { backend: { advanceClock(ms: number): void } }).backend.advanceClock(20_000);
    const settled = await second.getTransferStatus(r.id);
    expect(settled).toMatchObject({ state: 'SUCCESS', transaction: { id: 'trf-1' } });
  });
});

describe('the verified phone stays in memory (ADR-0014 §6, BM-07 follow-up)', () => {
  class CountingStore extends MemorySecureStore {
    reads = 0;
    override async get(key: string): Promise<string | undefined> {
      this.reads++;
      return super.get(key);
    }
  }

  it('the Send flow reads no secure storage once auth state is known; OTP and logout update it', async () => {
    const store = new CountingStore();
    const core = testCore({ secure: store, pinIterations: 1000 });
    await core.resetData(DEFAULT_DATASET);
    await verifyTestPhone(core);
    await core.setPin(PIN);
    await core.getAuthState(); // the lock screen does this at launch
    const before = store.reads;
    await core.searchContacts('');
    await core.startTransfer('u-01');
    expect(store.reads - before).toBe(0);

    await verifyTestPhone(core, transfer.directory[0].phone); // now this install is Andi
    expect((await core.searchContacts(transfer.directory[0].phone)).phoneLookup).toBe('SELF');
    await expect(core.startTransfer('u-01')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await core.logout();
    expect((await core.searchContacts(transfer.directory[0].phone)).phoneLookup).toBe('FOUND'); // nobody's phone now
  });

  it('without a prior read, the first call reads it once', async () => {
    const store = new CountingStore();
    const first = testCore({ secure: store, pinIterations: 1000 });
    await first.resetData(DEFAULT_DATASET);
    await verifyTestPhone(first);
    await first.setPin(PIN);
    const core = testCore({ secure: store, pinIterations: 1000 }); // a restart, no lock screen yet
    await core.searchContacts('');
    const after = store.reads;
    await core.startTransfer('u-01');
    await core.searchContacts('andi');
    expect(store.reads - after).toBe(0);
  });
});
