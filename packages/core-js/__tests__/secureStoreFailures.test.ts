import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DATASET } from '@pocketly/core-contract';
import type { Core } from '@pocketly/core-contract';
import { SECURE_KEYS } from '../src/security/pinAuth';
import { FaultySecureStore } from '../testing/faultySecureStore';
import { testCore } from '../testing/testCore';

/**
 * ADR-0010 §2.7: "can't read" isn't "corrupt". Temporarily unavailable → SECURE_STORAGE_UNAVAILABLE,
 * nothing wiped; permanently unreadable → onboarding restarts. Same cases as
 * shared/src/jvmTest/.../contract/PinFixturesTest.kt ("store failures").
 */
const GOOD = '482915';
const FAST = 1000;

describe('secure store failures (ADR-0010 §2.7)', () => {
  let dir: string;
  let store: FaultySecureStore;

  /** A core on files, so a "restart" sees the same replica (and install id). */
  const start = (): Core => testCore({ secure: store, serverPath: join(dir, 'server.db'), cachePath: join(dir, 'cache.db'), pinIterations: FAST });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pocketly-store-'));
    store = new FaultySecureStore();
    const core = start();
    await core.resetData(DEFAULT_DATASET);
    await core.setPin(GOOD);
  });

  it('temporarily unavailable: every call is SECURE_STORAGE_UNAVAILABLE and nothing is wiped', async () => {
    const core = start(); // e.g. launched in the background before the user unlocks
    const before = new Map(store.values);
    store.unavailable = true;
    await expect(core.getAuthState()).rejects.toMatchObject({ code: 'SECURE_STORAGE_UNAVAILABLE' });
    await expect(core.verifyPin(GOOD)).rejects.toMatchObject({ code: 'SECURE_STORAGE_UNAVAILABLE' });
    await expect(core.setPin('135792')).rejects.toMatchObject({ code: 'SECURE_STORAGE_UNAVAILABLE' });
    expect(store.values).toEqual(before);

    store.unavailable = false; // the user unlocked the phone
    expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0 });
    expect((await core.verifyPin(GOOD)).outcome).toBe('UNLOCKED');
  });

  it('a counter write that fails never unlocks, and costs nothing once the store is back', async () => {
    const core = start();
    store.failingWrites.add(SECURE_KEYS.lockout);
    await expect(core.verifyPin(GOOD)).rejects.toMatchObject({ code: 'SECURE_STORAGE_UNAVAILABLE' });
    store.failingWrites.clear();
    expect(await core.getAuthState()).toEqual({ pinSet: true, failedAttempts: 0 });
    expect((await core.verifyPin(GOOD)).outcome).toBe('UNLOCKED');
  });

  it('a permanently unreadable PIN record restarts onboarding', async () => {
    store.unreadable.add(SECURE_KEYS.pin);
    const core = start();
    expect(await core.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
    await expect(core.verifyPin(GOOD)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a permanently unreadable install id wipes every secret', async () => {
    store.unreadable.add(SECURE_KEYS.installId);
    const core = start();
    expect(await core.getAuthState()).toEqual({ pinSet: false, failedAttempts: 0 });
    expect([...store.values.keys()]).toEqual([SECURE_KEYS.installId]);
  });
});
