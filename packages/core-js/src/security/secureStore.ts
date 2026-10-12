/**
 * Secrets storage (NFR-SEC-01, ADR-0010): the PIN record, the attempt counter, the install id.
 * Never holds financial data. Implementations:
 *  - sensitiveInfoStore (the app: react-native-sensitive-info v6, Keystore / Keychain)
 *  - MemorySecureStore (Jest and scripts)
 * Kotlin: shared/.../security/SecureStore.kt.
 */
export interface SecureStore {
  /** undefined when the key is absent, or its value can no longer be decrypted (then it's deleted). */
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
