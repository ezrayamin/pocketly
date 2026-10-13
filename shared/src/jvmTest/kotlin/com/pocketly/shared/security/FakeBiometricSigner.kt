package com.pocketly.shared.security

import com.pocketly.shared.domain.BiometricKind
import com.pocketly.shared.domain.BiometricPromptText
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** A software P-256 key with scripted outcomes. Mirrors packages/core-js/testing/fakeBiometricSigner.ts. */
class FakeBiometricSigner : BiometricSigner {
    enum class Scan { MATCH, CANCEL, LOCKOUT, INVALIDATED, DEVICE_LOCKED, REPLAY, OTHER_KEY }

    var hardwareState = SignerHardware(available = true, kind = BiometricKind.FINGERPRINT)
    /** What the next scans do, in order; MATCH once the list is empty. */
    val scans = ArrayDeque<Scan>()
    /** Runs while the prompt is "open" (tests move the clock here). */
    var duringPrompt: () -> Unit = {}
    val prompts = mutableListOf<BiometricPromptText>()
    private var key: PrivateKey? = null
    private val other = newPair().private
    private var lastSignature: ByteArray? = null

    val hasKey get() = key != null

    override suspend fun hardware() = hardwareState

    override suspend fun createKey(): ByteArray = newPair().also { key = it.private }.public.encoded

    override suspend fun sign(message: ByteArray, prompt: BiometricPromptText): SignResult {
        prompts += prompt
        duringPrompt()
        val scan = scans.removeFirstOrNull() ?: Scan.MATCH
        val current = key
        return when {
            scan == Scan.DEVICE_LOCKED -> throw IllegalStateException("device locked")
            scan == Scan.CANCEL -> SignResult.Cancelled
            scan == Scan.LOCKOUT -> SignResult.LockedOut
            scan == Scan.INVALIDATED || current == null -> SignResult.Invalidated
            scan == Scan.REPLAY -> SignResult.Signed(lastSignature ?: byteArrayOf(0))
            else -> {
                val signature = Signature.getInstance("SHA256withECDSA").run {
                    initSign(if (scan == Scan.OTHER_KEY) other else current)
                    update(message)
                    sign()
                }
                if (scan == Scan.MATCH) lastSignature = signature
                SignResult.Signed(signature)
            }
        }
    }

    override suspend fun deleteKey() {
        key = null
    }

    private companion object {
        fun newPair() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    }
}
