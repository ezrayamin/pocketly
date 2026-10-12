import { PIN_LOCKOUT_MS, PIN_MAX_ATTEMPTS, PIN_PBKDF2_ITERATIONS } from '@pocketly/core-contract';
import pin from '@pocketly/core-contract/fixtures/pin.json';
import { CacheStore } from '../src/data/cacheStore';
import { PinAuth, SECURE_KEYS, hashPin, type InstallMarker } from '../src/security/pinAuth';
import type { PinCrypto } from '../src/security/pinCrypto';
import { decodePinRecord, encodeLockout, encodePinRecord, toHex } from '../src/security/pinPolicy';
import { MemorySecureStore } from '../src/security/secureStore';
import { nodePinCrypto } from '../testing/nodePinCrypto';
import { nodeSqliteDriver } from '../testing/nodeSqliteDriver';

const GOOD = '482915';
const WRONG = '731048';
const FAST = 1000; // iterations for tests that aren't about the work factor

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

class MemoryMarker implements InstallMarker {
  constructor(public id: string | undefined = undefined) {}
  async get() {
    return this.id;
  }
  async set(id: string) {
    this.id = id;
  }
}

function setup(overrides: { store?: MemorySecureStore; marker?: MemoryMarker; crypto?: PinCrypto; iterations?: number } = {}) {
  const store = overrides.store ?? new MemorySecureStore();
  const marker = overrides.marker ?? new MemoryMarker();
  let now = 1_790_856_000_000;
  const clock = { advance: (ms: number) => (now += ms), now: () => now };
  const auth = new PinAuth({
    store,
    marker,
    crypto: overrides.crypto ?? nodePinCrypto,
    clock: () => now,
    iterations: overrides.iterations ?? FAST,
  });
  return { auth, store, marker, clock };
}

describe('hashPin: same PIN, salt and iterations give the same hash in both cores (fixtures/pin.json)', () => {
  it.each(pin.pbkdf2)('$pin × $iterations', async ({ pin: p, saltHex, iterations, hashHex }) => {
    expect(toHex(await hashPin(nodePinCrypto, p, fromHex(saltHex), iterations))).toBe(hashHex);
  });

  it('the stored record encodes exactly as the fixture', () => {
    const v = pin.pbkdf2[3];
    const record = { iterations: v.iterations, salt: fromHex(v.saltHex), hash: fromHex(v.hashHex) };
    expect(encodePinRecord(record)).toBe(pin.record.encoded);
    expect(decodePinRecord(pin.record.encoded, 16, 32)).toEqual(record);
  });

  it.each(pin.record.unreadable)('decodePinRecord(%p) is unreadable', (encoded) => {
    expect(decodePinRecord(encoded, 16, 32)).toBeUndefined();
  });

  it('a fixture record verifies through PinAuth at the production work factor', async () => {
    const store = new MemorySecureStore();
    store.values.set(SECURE_KEYS.installId, 'install-1');
    store.values.set(SECURE_KEYS.pin, pin.record.encoded);
    store.values.set(SECURE_KEYS.lockout, encodeLockout({ failedAttempts: 0, lockedUntil: 0 }));
    const { auth } = setup({ store, marker: new MemoryMarker('install-1'), iterations: PIN_PBKDF2_ITERATIONS });
    expect((await auth.verifyPin(pin.record.pin)).outcome).toBe('UNLOCKED');
    expect((await auth.verifyPin('482915')).outcome).toBe('WRONG_PIN');
  });
});

describe('PinAuth', () => {
  it('never stores the PIN, only a salted record with a fresh salt each time (FR-AUTH-05)', async () => {
    const { auth, store } = setup();
    await auth.setPin(GOOD);
    const first = store.values.get(SECURE_KEYS.pin)!;
    await auth.setPin(GOOD);
    const second = store.values.get(SECURE_KEYS.pin)!;
    for (const value of store.values.values()) expect(value).not.toContain(GOOD);
    expect(decodePinRecord(first, 16, 32)!.salt).not.toEqual(decodePinRecord(second, 16, 32)!.salt);
  });

  it('the counter survives a restart: it lives in secure storage, not memory', async () => {
    const { auth, store, marker } = setup();
    await auth.setPin(GOOD);
    await auth.verifyPin(WRONG);
    await auth.verifyPin(WRONG);
    const restarted = setup({ store, marker }).auth;
    expect(await restarted.getAuthState()).toEqual({ pinSet: true, failedAttempts: 2 });
  });

  it('counts the attempt before hashing, so dying mid-hash still costs an attempt', async () => {
    const { auth, store, marker } = setup();
    await auth.setPin(GOOD);
    const dying: PinCrypto = { ...nodePinCrypto, pbkdf2Sha256: () => Promise.reject(new Error('process killed')) };
    await expect(setup({ store, marker, crypto: dying }).auth.verifyPin(GOOD)).rejects.toThrow('process killed');
    expect(await auth.getAuthState()).toEqual({ pinSet: true, failedAttempts: 1 });
  });

  it('dying mid-hash on the last attempt leaves the lockout in place', async () => {
    const { auth, store, marker } = setup();
    await auth.setPin(GOOD);
    for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) await auth.verifyPin(WRONG);
    const dying: PinCrypto = { ...nodePinCrypto, pbkdf2Sha256: () => Promise.reject(new Error('process killed')) };
    await expect(setup({ store, marker, crypto: dying }).auth.verifyPin(GOOD)).rejects.toThrow();
    expect((await auth.getAuthState()).lockedUntil).toBeDefined();
  });

  it('a lockout ends after PIN_LOCKOUT_MS and gives a fresh set of attempts', async () => {
    const { auth, clock } = setup();
    await auth.setPin(GOOD);
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) await auth.verifyPin(WRONG);
    const lockedUntil = clock.now() + PIN_LOCKOUT_MS;
    clock.advance(PIN_LOCKOUT_MS - 1);
    expect(await auth.verifyPin(GOOD)).toEqual({ outcome: 'LOCKED_OUT', attemptsLeft: 0, lockedUntil });
    clock.advance(1);
    expect(await auth.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0 });
    expect(await auth.verifyPin(WRONG)).toEqual({ outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - 1 });
    expect((await auth.verifyPin(GOOD)).outcome).toBe('UNLOCKED');
  });

  it('runs calls one at a time: concurrent wrong attempts are all counted', async () => {
    const { auth } = setup();
    await auth.setPin(GOOD);
    const results = await Promise.all([auth.verifyPin(WRONG), auth.verifyPin(WRONG), auth.verifyPin(WRONG)]);
    expect(results.map((r) => r.attemptsLeft)).toEqual([4, 3, 2]);
  });

  it('re-hashes with the current work factor after a successful unlock', async () => {
    const { auth, store, marker } = setup({ iterations: FAST });
    await auth.setPin(GOOD);
    const upgraded = setup({ store, marker, iterations: 2 * FAST }).auth;
    expect((await upgraded.verifyPin(GOOD)).outcome).toBe('UNLOCKED');
    expect(decodePinRecord(store.values.get(SECURE_KEYS.pin)!, 16, 32)!.iterations).toBe(2 * FAST);
    expect((await upgraded.verifyPin(GOOD)).outcome).toBe('UNLOCKED');
  });

  it('an unreadable PIN record wipes the secrets: onboarding starts again', async () => {
    const { auth, store, marker } = setup();
    await auth.setPin(GOOD);
    store.values.set(SECURE_KEYS.pin, '{"v":99}');
    const restarted = setup({ store, marker }).auth;
    expect(await restarted.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
    expect([...store.values.keys()]).toEqual([SECURE_KEYS.installId]);
  });

  it('an unreadable counter fails closed: locked out from now', async () => {
    const { auth, store, marker, clock } = setup();
    await auth.setPin(GOOD);
    store.values.set(SECURE_KEYS.lockout, 'garbage');
    const result = await setup({ store, marker }).auth.verifyPin(GOOD);
    expect(result).toEqual({ outcome: 'LOCKED_OUT', attemptsLeft: 0, lockedUntil: clock.now() + PIN_LOCKOUT_MS });
  });

  it('a counter missing while a PIN is set fails closed too', async () => {
    const { auth, store, marker, clock } = setup();
    await auth.setPin(GOOD);
    store.values.delete(SECURE_KEYS.lockout);
    const restarted = setup({ store, marker }).auth;
    expect(await restarted.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0, lockedUntil: clock.now() + PIN_LOCKOUT_MS });
  });

  describe('install binding (iOS keeps Keychain items across reinstalls)', () => {
    it('a fresh install wipes secrets it finds and records a new install id', async () => {
      const store = new MemorySecureStore();
      store.values.set(SECURE_KEYS.pin, pin.record.encoded);
      store.values.set(SECURE_KEYS.installId, 'old-install');
      const { auth, marker } = setup({ store, marker: new MemoryMarker(undefined) });
      expect(await auth.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
      expect(marker.id).toMatch(/^[0-9a-f]{32}$/);
      expect(store.values.get(SECURE_KEYS.installId)).toBe(marker.id);
    });

    it('secrets from another install are wiped', async () => {
      const store = new MemorySecureStore();
      store.values.set(SECURE_KEYS.pin, pin.record.encoded);
      store.values.set(SECURE_KEYS.installId, 'old-install');
      const { auth } = setup({ store, marker: new MemoryMarker('new-install') });
      expect((await auth.getAuthState()).pinSet).toBe(false);
      expect(store.values.get(SECURE_KEYS.installId)).toBe('new-install');
    });

    it('the same install keeps its secrets', async () => {
      const { auth, store, marker } = setup();
      await auth.setPin(GOOD);
      expect((await setup({ store, marker }).auth.getAuthState()).pinSet).toBe(true);
    });

    it('the replica keeps the install id through clear() (resetData, logout)', async () => {
      const cache = new CacheStore(nodeSqliteDriver());
      await cache.init();
      await cache.setInstallId('install-1');
      await cache.markSynced('token', 1);
      await cache.clear();
      expect(await cache.installId()).toBe('install-1');
      expect(await cache.syncToken()).toBeUndefined();
    });
  });
});
