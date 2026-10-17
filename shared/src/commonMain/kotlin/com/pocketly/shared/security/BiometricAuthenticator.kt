package com.pocketly.shared.security

import com.pocketly.shared.domain.BiometricEnableOutcome
import com.pocketly.shared.domain.BiometricEnableResult
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.BiometricStatus
import com.pocketly.shared.domain.BiometricUnavailableReason
import com.pocketly.shared.domain.BiometricUnlockOutcome
import com.pocketly.shared.domain.BiometricUnlockResult
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.UnlockOutcome
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.cancellation.CancellationException

/**
 * FR-AUTH-04 (ADR-0012). Biometric unlock = the biometric key signs a single-use challenge the
 * core just made, and the core verifies the signature with the public key it stored when
 * biometrics were enabled. On Android the scan unlocks the signing operation itself (the
 * Signature goes into BiometricPrompt as its CryptoObject), so a faked "success" callback can't
 * produce a signature. Mirrors packages/core-js/src/security/biometricAuth.ts.
 */
class BiometricAuthenticator(
    private val pin: PinAuthenticator,
    private val signer: BiometricSigner,
    private val crypto: PinCrypto,
    private val clock: () -> Long,
) {
    private class Challenge(val issuedAt: Long)

    /** Challenges handed out and not yet answered. Memory only: a restart forgets them. */
    private val pending = HashMap<String, Challenge>()
    private val pendingLock = Mutex()

    @Throws(CoreException::class, CancellationException::class)
    suspend fun status(): BiometricStatus {
        val enabled = pin.withStore { it.get(PinAuthenticator.KEY_BIOMETRIC_PUBLIC_KEY) != null }
        val hw = try {
            signer.hardware()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            SignerHardware(available = false, reason = BiometricUnavailableReason.TEMPORARILY_UNAVAILABLE)
        }
        return BiometricStatus(hw.available, hw.reason, hw.kind, enabled)
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun enable(pinCode: String, prompt: BiometricPromptText): BiometricEnableResult {
        val hw = try {
            signer.hardware()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        if (hw == null || hw.reason == BiometricUnavailableReason.TEMPORARILY_UNAVAILABLE) return BiometricEnableResult(BiometricEnableOutcome.UNAVAILABLE)
        if (!hw.available) return BiometricEnableResult(BiometricEnableOutcome.NOT_AVAILABLE)
        // The PIN first: an unlocked phone left on a table mustn't be enough to turn biometrics on.
        val check = pin.verifyPin(pinCode)
        when (check.outcome) {
            UnlockOutcome.WRONG_PIN -> return BiometricEnableResult(BiometricEnableOutcome.WRONG_PIN, attemptsLeft = check.attemptsLeft)
            UnlockOutcome.LOCKED_OUT -> return BiometricEnableResult(BiometricEnableOutcome.PIN_LOCKED_OUT, lockedUntil = check.lockedUntil)
            UnlockOutcome.UNLOCKED -> Unit
        }
        val publicKey = try {
            signer.createKey()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return BiometricEnableResult(BiometricEnableOutcome.UNAVAILABLE)
        }
        // One scan to prove the key works for this user before turning anything on.
        val signed = try {
            signChallenge(prompt)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        val result = signed?.result
        if (result is SignResult.Signed && answers(signed.nonce, signed.bytes, result.signature, publicKey)) {
            pin.withStore { it.put(PinAuthenticator.KEY_BIOMETRIC_PUBLIC_KEY, publicKey.toHex()) }
            return BiometricEnableResult(BiometricEnableOutcome.ENABLED)
        }
        deleteKeyQuietly()
        return BiometricEnableResult(
            when (result) {
                SignResult.Cancelled -> BiometricEnableOutcome.CANCELLED
                SignResult.LockedOut -> BiometricEnableOutcome.BIOMETRIC_LOCKED_OUT
                else -> BiometricEnableOutcome.UNAVAILABLE
            },
        )
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun disable() {
        pin.withStore { store ->
            deleteKeyQuietly()
            store.remove(PinAuthenticator.KEY_BIOMETRIC_PUBLIC_KEY)
        }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun unlock(prompt: BiometricPromptText): BiometricUnlockResult {
        val stored = pin.withStore { it.get(PinAuthenticator.KEY_BIOMETRIC_PUBLIC_KEY) }
            ?: throw CoreException(ErrorCode.NOT_FOUND, "biometric unlock is not enabled")

        // The prompt runs outside the auth queue: it can take as long as the user likes.
        val signed = try {
            signChallenge(prompt)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return BiometricUnlockResult(BiometricUnlockOutcome.UNAVAILABLE, pinLockedOut = false) // temporary
        }
        when (val result = signed.result) {
            SignResult.Cancelled -> return BiometricUnlockResult(BiometricUnlockOutcome.CANCELLED, false)
            SignResult.LockedOut -> return BiometricUnlockResult(BiometricUnlockOutcome.BIOMETRIC_LOCKED_OUT, false)
            SignResult.Invalidated -> {
                disable() // every permanent loss takes the same path: off, PIN, offer again
                return BiometricUnlockResult(BiometricUnlockOutcome.KEY_INVALIDATED, false)
            }
            is SignResult.Signed -> {
                val challenge = pendingLock.withLock { pending.remove(signed.nonce) }
                if (challenge == null || clock() - challenge.issuedAt > BiometricMessages.CHALLENGE_TTL_MS) {
                    return BiometricUnlockResult(BiometricUnlockOutcome.FAILED, false) // expired: a slow user, not an attack
                }
                if (!crypto.verifyP256(stored.hexToByteArray(), signed.bytes, result.signature)) {
                    disable() // a signature that doesn't verify can't be trusted to again
                    return BiometricUnlockResult(BiometricUnlockOutcome.FAILED, false)
                }
                // Never touches the PIN counter; a running lockout stays and the user is told about it.
                return BiometricUnlockResult(BiometricUnlockOutcome.UNLOCKED, pinLockedOut = pin.withStore { pin.lockedOutNow() })
            }
        }
    }

    /** Logout / reset: the key goes with the other secrets. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun reset() {
        deleteKeyQuietly()
        pendingLock.withLock { pending.clear() }
        pin.resetAuth()
    }

    private class Signed(val nonce: String, val bytes: ByteArray, val result: SignResult)

    private suspend fun signChallenge(prompt: BiometricPromptText): Signed {
        val nonce = crypto.randomBytes(BiometricMessages.NONCE_BYTES).toHex()
        pendingLock.withLock { pending[nonce] = Challenge(clock()) }
        val bytes = BiometricMessages.unlock(nonce).encodeToByteArray()
        try {
            return Signed(nonce, bytes, signer.sign(bytes, prompt))
        } catch (e: Throwable) {
            pendingLock.withLock { pending.remove(nonce) }
            throw e
        }
    }

    /** enable(): the confirming scan answered our challenge, in time, with the new key. */
    private suspend fun answers(nonce: String, bytes: ByteArray, signature: ByteArray, publicKey: ByteArray): Boolean {
        val challenge = pendingLock.withLock { pending.remove(nonce) }
        return challenge != null &&
            clock() - challenge.issuedAt <= BiometricMessages.CHALLENGE_TTL_MS &&
            crypto.verifyP256(publicKey, bytes, signature)
    }

    private suspend fun deleteKeyQuietly() {
        try {
            signer.deleteKey()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // best effort: a key we can't delete is replaced by the next createKey
        }
    }
}
