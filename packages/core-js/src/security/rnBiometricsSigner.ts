import {
  BiometricStrength,
  createKeysWithOptions,
  deleteKeys,
  InputEncoding,
  isSensorAvailable,
  signWithOptions,
} from '@sbaiahmed1/react-native-biometrics';
import { Buffer } from 'react-native-quick-crypto';
import type { BiometricSigner, SignResult, SignerHardware } from './biometricSigner';

/**
 * jsCore's biometric key (ADR-0012): @sbaiahmed1/react-native-biometrics 0.16.1, vetted and
 * patched (patches/@sbaiahmed1+react-native-biometrics+0.16.1.patch). EC P-256, strong
 * biometrics only, a scan before every signature, no device-passcode fallback:
 *  - Android: AndroidKeyStore (StrongBox if present), `validity -1` = per use, biometric only;
 *    the Signature goes into BiometricPrompt as its CryptoObject.
 *  - iOS: Secure Enclave, `.biometryCurrentSet` + `.privateKeyUsage`.
 * The library's own logging stays off (it's off by default; never enable it).
 */
const KEY_ALIAS = 'pocketly.biometric.v1';

/** Permanent: the key is gone or can no longer be used. Everything else not listed is temporary. */
const INVALIDATED = new Set(['KEY_INVALIDATED', 'BIOMETRY_CURRENT_SET_CHANGED', 'KEY_NOT_FOUND']);
const CANCELLED = new Set(['USER_CANCELED', 'SYSTEM_CANCELED', 'USER_CANCEL', 'SYSTEM_CANCEL', 'USER_FALLBACK', 'BIOMETRIC_TIMEOUT']);
const LOCKED_OUT = new Set([
  'BIOMETRIC_LOCKOUT',
  'BIOMETRIC_LOCKOUT_PERMANENT',
  'BIOMETRY_LOCKOUT',
  'BIOMETRY_LOCKOUT_PERMANENT',
  'TOUCH_ID_LOCKOUT',
  'FACE_ID_LOCKOUT',
]);

export function rnBiometricsSigner(): BiometricSigner {
  return {
    async hardware(): Promise<SignerHardware> {
      const strong = await isSensorAvailable({ biometricStrength: BiometricStrength.Strong });
      const kind =
        strong.biometryType === 'TouchID' ? 'FINGERPRINT' : strong.biometryType === 'FaceID' ? 'FACE' : 'OTHER';
      if (strong.available) return { available: true, kind };
      switch (strong.errorCode) {
        case 'BiometricErrorNoneEnrolled':
        case 'BIOMETRY_NOT_ENROLLED':
        case 'TOUCH_ID_NOT_ENROLLED':
        case 'FACE_ID_NOT_ENROLLED':
          return { available: false, reason: 'NOT_ENROLLED' };
        case 'BiometricErrorHwUnavailable':
        case 'BIOMETRY_LOCKOUT':
        case 'BiometricStatusUnknown':
          return { available: false, reason: 'TEMPORARILY_UNAVAILABLE' };
      }
      // A weak (Class 2) sensor can't protect a key: say so rather than "no hardware".
      const weak = await isSensorAvailable({ biometricStrength: BiometricStrength.Weak }).catch(() => undefined);
      return { available: false, reason: weak?.available ? 'NOT_STRONG' : 'NO_HARDWARE' };
    },

    async createKey(): Promise<Uint8Array> {
      await deleteKeys(KEY_ALIAS).catch(() => undefined);
      const created = await createKeysWithOptions({
        keyAlias: KEY_ALIAS,
        keyType: 'ec256',
        requireAuthentication: true,
        biometricStrength: BiometricStrength.Strong,
        allowDeviceCredentials: false,
      });
      return new Uint8Array(Buffer.from(created.publicKey, 'base64'));
    },

    async sign(message, prompt): Promise<SignResult> {
      const result = await signWithOptions({
        keyAlias: KEY_ALIAS,
        data: Buffer.from(message).toString('base64'),
        inputEncoding: InputEncoding.Base64,
        promptTitle: prompt.title,
        promptSubtitle: prompt.subtitle,
        cancelButtonText: prompt.cancel,
        biometricStrength: BiometricStrength.Strong,
        disableDeviceFallback: true,
      });
      if (result.success && result.signature) {
        return { kind: 'SIGNED', signature: new Uint8Array(Buffer.from(result.signature, 'base64')) };
      }
      const code = result.errorCode ?? '';
      if (CANCELLED.has(code)) return { kind: 'CANCELLED' };
      if (LOCKED_OUT.has(code)) return { kind: 'LOCKED_OUT' };
      if (INVALIDATED.has(code)) return { kind: 'INVALIDATED' };
      throw new Error(`biometric signing unavailable (${code || 'no code'})`); // temporary
    },

    async deleteKey(): Promise<void> {
      await deleteKeys(KEY_ALIAS);
    },
  };
}
