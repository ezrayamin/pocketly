/**
 * Secrets storage (NFR-SEC-01, ADR-0010): the PIN record, the attempt counter, the install id.
 * Never holds financial data.
 *
 * Two kinds of failure, kept apart because only one may lead to a wipe (ADR-0010 §2.7):
 *  - permanently unreadable (key invalidated or deleted, value tampered with): `get` deletes the
 *    value and returns undefined, exactly as if it had never been written;
 *  - temporarily unavailable (device locked, Keystore busy, anything else): the call throws.
 *    Nothing is lost; callers stay locked and try again later.
 *
 * Implementations:
 *  - sensitiveInfoStore (the app: react-native-sensitive-info v6, Keystore / Keychain)
 *  - MemorySecureStore (Jest and scripts)
 * Kotlin: shared/.../security/SecureStore.kt.
 */
export interface SecureStore {
  /** undefined when the key is absent or permanently unreadable (then it's deleted). Throws when temporarily unavailable. */
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Deletes every key this store holds. */
  clear(): Promise<void>;
}

export class MemorySecureStore implements SecureStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }
}
