import {
  CoreError,
  DEFAULT_AUTO_LOCK_MS,
  MAX_AUTO_LOCK_MS,
  PIN_HASH_BYTES,
  PIN_LOCKOUT_MS,
  PIN_MAX_ATTEMPTS,
  PIN_PBKDF2_ITERATIONS,
  PIN_SALT_BYTES,
} from '@pocketly/core-contract';
import type { AuthState, UnlockResult } from '@pocketly/core-contract';
import type { PinCrypto } from './pinCrypto';
import {
  checkPin,
  decodeLockout,
  decodePinRecord,
  encodeLockout,
  encodePinRecord,
  toHex,
  type LockoutState,
  type PinRecord,
} from './pinPolicy';
import type { SecureStore } from './secureStore';

export const SECURE_KEYS = {
  pin: 'pin',
  lockout: 'lockout',
  installId: 'installId',
  autoLockMs: 'autoLockMs',
  /** ADR-0012: the biometric key's public key (SPKI DER, hex). Present = biometric unlock on. */
  biometricPublicKey: 'biometricPublicKey',
  /**
   * ADR-0013: `{"phone":"+62…","token":"…","pinCreated":bool}` after OTP. Valid while no PIN has
   * been created yet, or while the PIN it created exists: losing the PIN record ends it.
   */
  session: 'session',
} as const;

/**
 * Where the current install's id lives outside secure storage: somewhere the OS deletes with the
 * app (the replica's cache_meta). iOS keeps Keychain items across uninstalls; a mismatch means the
 * secrets belong to an earlier install and are wiped (ADR-0010).
 */
export interface InstallMarker {
  get(): Promise<string | undefined>;
  set(id: string): Promise<void>;
}

export interface PinAuthOptions {
  store: SecureStore;
  crypto: PinCrypto;
  marker: InstallMarker;
  /** Device clock (lockouts). Tests inject one. */
  clock?: () => number;
  /** Work factor for new records. Tests lower it; the app always uses PIN_PBKDF2_ITERATIONS. */
  iterations?: number;
}

const NO_LOCKOUT: LockoutState = { failedAttempts: 0, lockedUntil: 0 };

/**
 * Any store failure is "temporarily unavailable" (ADR-0010 §2.7): it becomes
 * SECURE_STORAGE_UNAVAILABLE and nothing is wiped. Wipes need positive evidence: a value the
 * store reports as gone, or a record that's present but can't be parsed.
 */
function guarded(store: SecureStore): SecureStore {
  const wrap =
    <A extends unknown[], R>(op: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await op(...args);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new CoreError('SECURE_STORAGE_UNAVAILABLE', `secure storage unavailable: ${reason}`);
      }
    };
  return {
    get: wrap((key: string) => store.get(key)),
    set: wrap((key: string, value: string) => store.set(key, value)),
    delete: wrap((key: string) => store.delete(key)),
    clear: wrap(() => store.clear()),
  };
}
const encoder = new TextEncoder();

/** PBKDF2-HMAC-SHA256 over the PIN's ASCII bytes. Both cores must agree byte for byte (fixtures/pin.json). */
export function hashPin(crypto: PinCrypto, pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return crypto.pbkdf2Sha256(encoder.encode(pin), salt, iterations, PIN_HASH_BYTES);
}

/**
 * FR-AUTH-03/05 and FR-LOCK-04 over secure storage. Calls run one at a time, so two unlock
 * attempts can't both read the same counter. Mirrors shared/.../security/PinAuthenticator.kt.
 */
export class PinAuth {
  private readonly store: SecureStore;
  private readonly crypto: PinCrypto;
  private readonly marker: InstallMarker;
  private readonly clock: () => number;
  private readonly iterations: number;
  private queue: Promise<unknown> = Promise.resolve();
  private bound = false;

  constructor(options: PinAuthOptions) {
    this.store = guarded(options.store);
    this.crypto = options.crypto;
    this.marker = options.marker;
    this.clock = options.clock ?? Date.now;
    this.iterations = options.iterations ?? PIN_PBKDF2_ITERATIONS;
  }

  setPin(pin: string): Promise<void> {
    const check = checkPin(pin);
    if (!check.ok) return Promise.reject(new CoreError('INVALID_ARGUMENT', `PIN refused: ${check.reason}`));
    return this.serial(async () => {
      // ADR-0013: no PIN before the phone is verified, so "Forgot PIN" can't skip the OTP.
      const session = await this.readSession();
      if (session === undefined) throw new CoreError('NOT_FOUND', 'verify the phone number first');
      await this.store.set(SECURE_KEYS.session, JSON.stringify({ ...session, pinCreated: true }));
      await this.store.set(SECURE_KEYS.pin, encodePinRecord(await this.newRecord(pin)));
      await this.store.set(SECURE_KEYS.lockout, encodeLockout(NO_LOCKOUT));
    });
  }

  verifyPin(pin: string): Promise<UnlockResult> {
    return this.serial(async () => {
      const record = await this.readRecord();
      if (record === undefined) throw new CoreError('NOT_FOUND', 'no PIN set');
      const now = this.clock();
      const state = await this.readLockout(now, true);
      if (state.lockedUntil > now) {
        return { outcome: 'LOCKED_OUT', attemptsLeft: 0, lockedUntil: state.lockedUntil };
      }
      // Count the attempt as wrong before hashing: killing the app mid-hash keeps the count.
      const failed = state.failedAttempts + 1;
      const wrong: LockoutState =
        failed >= PIN_MAX_ATTEMPTS ? { failedAttempts: 0, lockedUntil: now + PIN_LOCKOUT_MS } : { failedAttempts: failed, lockedUntil: 0 };
      await this.store.set(SECURE_KEYS.lockout, encodeLockout(wrong));

      const hash = await this.hash(pin, record.salt, record.iterations);
      if (!this.crypto.timingSafeEqual(hash, record.hash)) {
        return wrong.lockedUntil > 0
          ? { outcome: 'LOCKED_OUT', attemptsLeft: 0, lockedUntil: wrong.lockedUntil }
          : { outcome: 'WRONG_PIN', attemptsLeft: PIN_MAX_ATTEMPTS - failed };
      }
      await this.store.set(SECURE_KEYS.lockout, encodeLockout(NO_LOCKOUT));
      if (record.iterations < this.iterations) {
        // The work factor went up since this PIN was set: re-hash while we know the PIN.
        await this.store.set(SECURE_KEYS.pin, encodePinRecord(await this.newRecord(pin)));
      }
      return { outcome: 'UNLOCKED', attemptsLeft: PIN_MAX_ATTEMPTS };
    });
  }

  getAuthState(): Promise<AuthState> {
    return this.serial(async () => {
      const pinSet = (await this.readRecord()) !== undefined;
      const phone = (await this.readSession())?.phone;
      const now = this.clock();
      const { failedAttempts, lockedUntil } = await this.readLockout(now, pinSet);
      const state: AuthState = lockedUntil > now ? { pinSet, failedAttempts, lockedUntil } : { pinSet, failedAttempts };
      return phone === undefined ? state : { phone, ...state };
    });
  }

  /** FR-LOCK-02. A stored value this version can't read counts as the default. */
  getAutoLockTimeout(): Promise<number> {
    return this.serial(async () => {
      const stored = await this.store.get(SECURE_KEYS.autoLockMs);
      const ms = stored !== undefined && /^\d+$/.test(stored) ? Number(stored) : NaN;
      return ms <= MAX_AUTO_LOCK_MS ? ms : DEFAULT_AUTO_LOCK_MS;
    });
  }

  setAutoLockTimeout(ms: number): Promise<void> {
    if (!Number.isInteger(ms) || ms < 0 || ms > MAX_AUTO_LOCK_MS) {
      return Promise.reject(new CoreError('INVALID_ARGUMENT', `auto-lock timeout must be 0..${MAX_AUTO_LOCK_MS} ms, got ${ms}`));
    }
    return this.serial(() => this.store.set(SECURE_KEYS.autoLockMs, String(ms)));
  }

  resetAuth(): Promise<void> {
    return this.serial(async () => {
      await this.store.clear();
      await this.store.set(SECURE_KEYS.installId, (await this.marker.get())!);
    });
  }

  /** ADR-0013: after VERIFIED, the phone (and the server's session token) belong to this install. */
  rememberVerifiedPhone(phone: string, token: string): Promise<void> {
    return this.serial(() => this.store.set(SECURE_KEYS.session, JSON.stringify({ phone, token, pinCreated: false })));
  }

  /**
   * The verified session, or undefined: none yet, one this version can't read, or one whose PIN
   * is gone (a lost PIN record must not let anyone set a new PIN without an OTP). Call after
   * readRecord in the same queued call, so a corrupt PIN record has been dealt with first.
   */
  private async readSession(): Promise<{ phone: string; token: string; pinCreated: boolean } | undefined> {
    const encoded = await this.store.get(SECURE_KEYS.session);
    if (encoded === undefined) return undefined;
    let session: { phone?: unknown; token?: unknown; pinCreated?: unknown };
    try {
      session = JSON.parse(encoded);
    } catch {
      return undefined;
    }
    if (typeof session.phone !== 'string' || typeof session.token !== 'string') return undefined;
    const pinCreated = session.pinCreated === true;
    if (pinCreated && (await this.store.get(SECURE_KEYS.pin)) === undefined) {
      await this.store.delete(SECURE_KEYS.session);
      return undefined;
    }
    return { phone: session.phone, token: session.token, pinCreated };
  }

  /** Biometrics (biometricAuth.ts): `work` on the guarded store, in this queue, bound to this install. */
  withStore<T>(work: (store: SecureStore) => Promise<T>): Promise<T> {
    return this.serial(() => work(this.store));
  }

  /** Biometrics: whether a PIN lockout is running (read inside withStore). */
  async lockedOutNow(): Promise<boolean> {
    const now = this.clock();
    return (await this.readLockout(now, true)).lockedUntil > now;
  }

  /** Runs `work` after every earlier call has settled, bound to this install. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.bound) {
        await this.bindToInstall();
        this.bound = true;
      }
      return work();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async bindToInstall(): Promise<void> {
    const installed = await this.marker.get();
    if (installed !== undefined && installed === (await this.store.get(SECURE_KEYS.installId))) return;
    // Secrets left by an earlier install (or none at all): start clean.
    await this.store.clear();
    const id = installed ?? toHex(this.crypto.randomBytes(16));
    if (installed === undefined) await this.marker.set(id);
    await this.store.set(SECURE_KEYS.installId, id);
  }

  /** An unreadable record can't be verified against, so every secret goes and onboarding restarts. */
  private async readRecord(): Promise<PinRecord | undefined> {
    const encoded = await this.store.get(SECURE_KEYS.pin);
    if (encoded === undefined) return undefined;
    const record = decodePinRecord(encoded, PIN_SALT_BYTES, PIN_HASH_BYTES);
    if (record === undefined) {
      await this.store.clear();
      await this.store.set(SECURE_KEYS.installId, (await this.marker.get())!);
    }
    return record;
  }

  /**
   * Expired lockouts read as none. A counter that's unreadable, or missing while a PIN is set
   * (setPin always writes one), fails closed: a lockout from now.
   */
  private async readLockout(now: number, pinSet: boolean): Promise<LockoutState> {
    const encoded = await this.store.get(SECURE_KEYS.lockout);
    if (encoded === undefined && !pinSet) return NO_LOCKOUT;
    const state = encoded === undefined ? undefined : decodeLockout(encoded);
    if (state === undefined) {
      const closed = { failedAttempts: 0, lockedUntil: now + PIN_LOCKOUT_MS };
      await this.store.set(SECURE_KEYS.lockout, encodeLockout(closed));
      return closed;
    }
    return state.lockedUntil !== 0 && state.lockedUntil <= now ? NO_LOCKOUT : state;
  }

  private async newRecord(pin: string): Promise<PinRecord> {
    const salt = this.crypto.randomBytes(PIN_SALT_BYTES);
    return { iterations: this.iterations, salt, hash: await this.hash(pin, salt, this.iterations) };
  }

  private hash(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    return hashPin(this.crypto, pin, salt, iterations);
  }
}
