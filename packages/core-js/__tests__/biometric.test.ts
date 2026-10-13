import { BIOMETRIC_CHALLENGE_TTL_MS, PIN_MAX_ATTEMPTS } from '@pocketly/core-contract';
import type { Core } from '@pocketly/core-contract';
import bio from '@pocketly/core-contract/fixtures/biometric.json';
import { transferMessage, unlockMessage, utf8 } from '../src/security/biometricMessages';
import { FakeBiometricSigner } from '../testing/fakeBiometricSigner';
import { nodePinCrypto } from '../testing/nodePinCrypto';
import { verifyTestPhone } from '@pocketly/core-contract/src/testing/onboarding';
import { testCore } from '../testing/testCore';

/** ADR-0012. Same cases as shared/src/jvmTest/.../contract/BiometricTest.kt. */

const hex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const GOOD = '482915';
const WRONG = '731048';
const PROMPT = { title: 'Unlock Pocketly', cancel: 'Use PIN' };

describe('biometric messages and signatures (fixtures/biometric.json)', () => {
  it('builds the unlock and transfer messages byte for byte', () => {
    expect(unlockMessage(bio.unlock.nonceHex)).toBe(bio.unlock.message);
    const { amount, recipientId, idempotencyKey } = bio.transfer;
    expect(transferMessage({ amount, recipientId, idempotencyKey })).toBe(bio.transfer.message);
  });

  it.each(bio.invalidTransfers)('refuses a transfer that can\'t be encoded unambiguously: $why', ({ amount, recipientId, idempotencyKey }) => {
    expect(() => transferMessage({ amount, recipientId, idempotencyKey })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('accepts the fixture signatures', () => {
    const key = hex(bio.publicKeyHex);
    expect(nodePinCrypto.verifyP256(key, utf8(bio.unlock.message), hex(bio.unlock.signatureHex))).toBe(true);
    expect(nodePinCrypto.verifyP256(key, utf8(bio.transfer.message), hex(bio.transfer.signatureHex))).toBe(true);
  });

  it.each(bio.rejected)('rejects: $why', ({ message, signatureHex }) => {
    expect(nodePinCrypto.verifyP256(hex(bio.publicKeyHex), utf8(message), hex(signatureHex))).toBe(false);
  });

  it('the challenge TTL is the fixture\'s', () => {
    expect(BIOMETRIC_CHALLENGE_TTL_MS).toBe(bio.params.challengeTtlMs);
  });
});

describe('biometric unlock (FR-AUTH-04)', () => {
  let signer: FakeBiometricSigner;
  let now: number;
  let core: Core;

  beforeEach(async () => {
    signer = new FakeBiometricSigner();
    now = 1_790_856_000_000;
    core = testCore({ biometrics: signer, clock: () => now, pinIterations: 1000 });
    await verifyTestPhone(core);
    await core.setPin(GOOD);
  });

  const enable = async () => expect(await core.enableBiometrics(GOOD, PROMPT)).toEqual({ outcome: 'ENABLED' });

  it('starts off; reports the hardware', async () => {
    expect(await core.getBiometricStatus()).toEqual({ available: true, kind: 'FINGERPRINT', enabled: false });
    signer.hardwareState = { available: false, reason: 'NOT_STRONG' };
    expect(await core.getBiometricStatus()).toEqual({ available: false, reason: 'NOT_STRONG', enabled: false });
    await expect(core.unlockWithBiometrics(PROMPT)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enabling checks the PIN first, counting a wrong one, and creates no key', async () => {
    expect(await core.enableBiometrics(WRONG, PROMPT)).toEqual({ outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - 1 });
    expect((await core.getAuthState()).failedAttempts).toBe(1);
    expect(signer.hasKey).toBe(false);
    expect((await core.getBiometricStatus()).enabled).toBe(false);
  });

  it('enabling needs a strong biometric', async () => {
    signer.hardwareState = { available: false, reason: 'NOT_ENROLLED' };
    expect(await core.enableBiometrics(GOOD, PROMPT)).toEqual({ outcome: 'NOT_AVAILABLE' });
  });

  it('enabling is confirmed by one scan; cancelling it leaves biometrics off and no key', async () => {
    signer.scans.push('CANCEL');
    expect(await core.enableBiometrics(GOOD, PROMPT)).toEqual({ outcome: 'CANCELLED' });
    expect(signer.hasKey).toBe(false);
    expect((await core.getBiometricStatus()).enabled).toBe(false);
    await enable();
    expect(signer.prompts).toEqual([PROMPT, PROMPT]);
    expect((await core.getBiometricStatus()).enabled).toBe(true);
  });

  it('unlocks with a fresh signed challenge; cancel and OS lockout change nothing', async () => {
    await enable();
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'UNLOCKED', pinLockedOut: false });
    signer.scans.push('CANCEL', 'LOCKOUT');
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'CANCELLED', pinLockedOut: false });
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'BIOMETRIC_LOCKED_OUT', pinLockedOut: false });
    expect((await core.getBiometricStatus()).enabled).toBe(true);
  });

  it('temporarily unavailable (device locked): nothing changes, the key stays', async () => {
    await enable();
    signer.scans.push('DEVICE_LOCKED');
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'UNAVAILABLE', pinLockedOut: false });
    expect(signer.hasKey).toBe(true);
    expect((await core.getBiometricStatus()).enabled).toBe(true);
    expect((await core.unlockWithBiometrics(PROMPT)).outcome).toBe('UNLOCKED');
  });

  it('an invalidated key turns biometrics off; turning them on again needs the PIN', async () => {
    await enable();
    signer.scans.push('INVALIDATED');
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'KEY_INVALIDATED', pinLockedOut: false });
    expect(signer.hasKey).toBe(false);
    expect((await core.getBiometricStatus()).enabled).toBe(false);
    expect((await core.enableBiometrics(WRONG, PROMPT)).outcome).toBe('WRONG_PIN');
    await enable();
  });

  it('rejects a replayed signature (an earlier unlock\'s) and turns biometrics off', async () => {
    await enable();
    expect((await core.unlockWithBiometrics(PROMPT)).outcome).toBe('UNLOCKED');
    signer.scans.push('REPLAY');
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'FAILED', pinLockedOut: false });
    expect((await core.getBiometricStatus()).enabled).toBe(false);
  });

  it('rejects a signature from another key and turns biometrics off', async () => {
    await enable();
    signer.scans.push('OTHER_KEY');
    expect((await core.unlockWithBiometrics(PROMPT)).outcome).toBe('FAILED');
    expect((await core.getBiometricStatus()).enabled).toBe(false);
  });

  it('rejects an answer that comes after the challenge expired, but leaves biometrics on', async () => {
    await enable();
    signer.duringPrompt = () => {
      now += BIOMETRIC_CHALLENGE_TTL_MS + 1;
    };
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'FAILED', pinLockedOut: false });
    expect((await core.getBiometricStatus()).enabled).toBe(true);
  });

  it('unlocks during a PIN lockout without touching it, and says so', async () => {
    await enable();
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) await core.verifyPin(WRONG);
    const before = await core.getAuthState();
    expect(before.lockedUntil).toBeDefined();
    expect(await core.unlockWithBiometrics(PROMPT)).toEqual({ outcome: 'UNLOCKED', pinLockedOut: true });
    expect(await core.getAuthState()).toEqual(before);
  });

  it('resetAuth deletes the key and turns biometrics off', async () => {
    await enable();
    await core.resetAuth();
    expect(signer.hasKey).toBe(false);
    expect((await core.getBiometricStatus()).enabled).toBe(false);
  });

  it('disableBiometrics deletes the key', async () => {
    await enable();
    await core.disableBiometrics();
    expect(signer.hasKey).toBe(false);
    await expect(core.unlockWithBiometrics(PROMPT)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
