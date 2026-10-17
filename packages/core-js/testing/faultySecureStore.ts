import { MemorySecureStore } from '../src/security/secureStore';

/**
 * A secure store that fails the two ways a real one can (ADR-0010 §2.7). Mirrors
 * shared/src/jvmTest/.../security/FaultySecureStore.kt.
 */
export class FaultySecureStore extends MemorySecureStore {
  /** Temporarily unavailable, as while the device is locked: every call throws. */
  unavailable = false;
  /** set() of these keys throws (temporarily unavailable). */
  readonly failingWrites = new Set<string>();
  /** get() of these keys finds them permanently unreadable: deleted, reported absent. */
  readonly unreadable = new Set<string>();

  async get(key: string): Promise<string | undefined> {
    this.check();
    if (this.unreadable.has(key)) {
      this.values.delete(key);
      return undefined;
    }
    return super.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.check();
    if (this.failingWrites.has(key)) throw new Error(`write of ${key} failed: Keystore busy`);
    return super.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.check();
    return super.delete(key);
  }

  async clear(): Promise<void> {
    this.check();
    return super.clear();
  }

  private check(): void {
    if (this.unavailable) throw new Error('device locked: errSecInteractionNotAllowed');
  }
}
