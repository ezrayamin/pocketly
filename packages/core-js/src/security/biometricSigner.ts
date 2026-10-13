import type { BiometricKind, BiometricPromptText, BiometricUnavailableReason } from '@pocketly/core-contract';

/**
 * A strong-biometric-bound signing key (ADR-0012): EC P-256 in the Keystore (StrongBox if
 * present) or the Secure Enclave, usable only right after a strong biometric scan, every time,
 * and invalidated when the enrolled biometrics change. Implementations:
 *  - rnBiometricsSigner (the app: @sbaiahmed1/react-native-biometrics, patched)
 *  - tests: a software key with scripted outcomes
 * Kotlin: shared/.../security/BiometricSigner.kt.
 *
 * Failure kinds follow ADR-0010 §2.7: a permanent loss of the key is INVALIDATED; anything
 * temporary (device locked, sensor busy) throws, and nothing is changed.
 */
export interface SignerHardware {
  available: boolean;
  reason?: BiometricUnavailableReason;
  kind?: BiometricKind;
}

export type SignResult =
  | { kind: 'SIGNED'; signature: Uint8Array }
  | { kind: 'CANCELLED' }
  | { kind: 'LOCKED_OUT' }
  | { kind: 'INVALIDATED' };

export interface BiometricSigner {
  hardware(): Promise<SignerHardware>;
  /** Replaces any existing key. Returns its public key, X.509 SubjectPublicKeyInfo DER. */
  createKey(): Promise<Uint8Array>;
  /** Shows the system prompt; on a successful scan signs `message` (ECDSA-SHA256, DER). */
  sign(message: Uint8Array, prompt: BiometricPromptText): Promise<SignResult>;
  /** No error if there's no key. */
  deleteKey(): Promise<void>;
}
