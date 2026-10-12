import {
  clearService,
  deleteItem,
  getItem,
  isIntegrityViolationError,
  isKeyInvalidatedError,
  setItem,
  type SensitiveInfoOptions,
} from 'react-native-sensitive-info';
import type { SecureStore } from './secureStore';

/**
 * jsCore's secure storage (ADR-0010): react-native-sensitive-info v6. Android: AES-256-GCM
 * under an AndroidKeyStore key (TEE, unlocked device required); iOS: Keychain, when unlocked,
 * this device only, never synced (with patches/react-native-sensitive-info+6.1.5.patch).
 * No biometric gate: the PIN record has to be readable to check a PIN.
 */
const OPTIONS: SensitiveInfoOptions = {
  service: 'com.pocketly.secure',
  accessControl: 'none',
  iosSynchronizable: false,
};

export function sensitiveInfoStore(): SecureStore {
  return {
    async get(key) {
      try {
        const item = await getItem(key, OPTIONS);
        return item?.value ?? undefined;
      } catch (e) {
        // The key behind this entry is gone or the entry was tampered with: it's unreadable for good.
        if (isKeyInvalidatedError(e) || isIntegrityViolationError(e)) {
          await deleteItem(key, OPTIONS);
          return undefined;
        }
        throw e;
      }
    },
    async set(key, value) {
      await setItem(key, value, OPTIONS);
    },
    async delete(key) {
      await deleteItem(key, OPTIONS);
    },
    async clear() {
      await clearService(OPTIONS);
    },
  };
}
