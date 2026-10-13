package com.pocketly.shared.security

import com.pocketly.shared.domain.BiometricKind
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.BiometricUnavailableReason

/**
 * A strong-biometric-bound signing key (ADR-0012): EC P-256 in the Keystore (StrongBox if
 * present) or the Secure Enclave, usable only right after a strong biometric scan, every time,
 * and invalidated when the enrolled biometrics change.
 *  - Android: [AndroidBiometricSigner] · iOS: [IosBiometricSigner] · none: [NoBiometricSigner]
 * Counterpart of packages/core-js/src/security/biometricSigner.ts.
 *
 * Failure kinds follow ADR-0010 §2.7: a permanent loss of the key is [SignResult.Invalidated];
 * anything temporary (device locked, sensor busy) throws, and nothing is changed.
 */
interface BiometricSigner {
    suspend fun hardware(): SignerHardware

    /** Replaces any existing key. Returns its public key, X.509 SubjectPublicKeyInfo DER. */
    suspend fun createKey(): ByteArray

    /** Shows the system prompt; on a successful scan signs [message] (ECDSA-SHA256, DER). */
    suspend fun sign(message: ByteArray, prompt: BiometricPromptText): SignResult

    /** No error if there's no key. */
    suspend fun deleteKey()
}

data class SignerHardware(val available: Boolean, val reason: BiometricUnavailableReason? = null, val kind: BiometricKind? = null)

sealed interface SignResult {
    class Signed(val signature: ByteArray) : SignResult
    data object Cancelled : SignResult
    data object LockedOut : SignResult
    data object Invalidated : SignResult
}

/** For platforms (and tests) without biometrics: never available. */
object NoBiometricSigner : BiometricSigner {
    override suspend fun hardware() = SignerHardware(available = false, reason = BiometricUnavailableReason.NO_HARDWARE)
    override suspend fun createKey(): ByteArray = error("no biometric hardware")
    override suspend fun sign(message: ByteArray, prompt: BiometricPromptText): SignResult = SignResult.Invalidated
    override suspend fun deleteKey() = Unit
}
