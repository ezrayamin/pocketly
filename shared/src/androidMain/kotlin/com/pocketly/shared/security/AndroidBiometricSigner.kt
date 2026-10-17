package com.pocketly.shared.security

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import android.util.Log
import com.pocketly.shared.domain.BiometricKind
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.BiometricUnavailableReason
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * kmpCore's biometric key on Android (ADR-0012). EC P-256 in AndroidKeyStore (StrongBox if the
 * device has one, else the TEE); a strong (Class 3) biometric scan before every signature
 * (`setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`); invalidated when biometrics are
 * enrolled or removed, or the screen lock is removed. The Signature goes into BiometricPrompt as
 * its CryptoObject, so only a real scan can produce a signature. No device-credential fallback:
 * the prompt's negative button leads to our PIN.
 */
class AndroidBiometricSigner(
    context: Context,
    /** The activity to show the prompt over (a FragmentActivity); null while the app has none in front. */
    private val activity: () -> Activity?,
) : BiometricSigner {
    private val app = context.applicationContext

    override suspend fun hardware(): SignerHardware {
        val manager = BiometricManager.from(app)
        return when (manager.canAuthenticate(BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> SignerHardware(available = true, kind = kind())
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> SignerHardware(false, BiometricUnavailableReason.NOT_ENROLLED)
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> SignerHardware(false, BiometricUnavailableReason.TEMPORARILY_UNAVAILABLE)
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> {
                // A weak (Class 2) sensor can't protect a key: say so rather than "no hardware".
                val weak = manager.canAuthenticate(BIOMETRIC_WEAK)
                val hasWeak = weak == BiometricManager.BIOMETRIC_SUCCESS || weak == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                SignerHardware(false, if (hasWeak) BiometricUnavailableReason.NOT_STRONG else BiometricUnavailableReason.NO_HARDWARE)
            }
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> SignerHardware(false, BiometricUnavailableReason.NOT_STRONG)
            else -> SignerHardware(false, BiometricUnavailableReason.TEMPORARILY_UNAVAILABLE)
        }
    }

    override suspend fun createKey(): ByteArray = withContext(Dispatchers.Default) {
        deleteKey()
        val strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            app.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        val pair = try {
            generate(strongBox)
        } catch (e: Exception) {
            if (strongBox && (e is StrongBoxUnavailableException || e.cause is StrongBoxUnavailableException)) generate(false) else throw e
        }
        logSecurityLevel(pair.private)
        pair.public.encoded // X.509 SubjectPublicKeyInfo DER
    }

    /** ADR-0012: where the key really lives (StrongBox, TEE). Logged once per key; no key material. */
    private fun logSecurityLevel(key: PrivateKey) {
        try {
            val info = KeyFactory.getInstance(key.algorithm, ANDROID_KEY_STORE).getKeySpec(key, KeyInfo::class.java)
            val level = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> "StrongBox"
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "TEE"
                    KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
                    else -> "level ${info.securityLevel}"
                }
            } else {
                @Suppress("DEPRECATION")
                if (info.isInsideSecureHardware) "secure hardware" else "software"
            }
            Log.i("PocketlyCrypto", "biometric key created in $level, per-use auth: ${info.isUserAuthenticationRequired}")
        } catch (e: Exception) {
            Log.i("PocketlyCrypto", "biometric key created; security level unknown (${e.javaClass.simpleName})")
        }
    }

    override suspend fun sign(message: ByteArray, prompt: BiometricPromptText): SignResult {
        val signature = Signature.getInstance("SHA256withECDSA")
        try {
            val key = keyStore().getKey(ALIAS, null) as PrivateKey? ?: return SignResult.Invalidated
            signature.initSign(key)
        } catch (_: KeyPermanentlyInvalidatedException) {
            return SignResult.Invalidated // biometrics or the screen lock changed
        }
        val outcome = withContext(Dispatchers.Main) { scan(signature, prompt) }
        return when (outcome) {
            is Scan.Authenticated -> withContext(Dispatchers.Default) {
                outcome.signature.update(message)
                SignResult.Signed(outcome.signature.sign())
            }
            Scan.Cancelled -> SignResult.Cancelled
            Scan.LockedOut -> SignResult.LockedOut
            Scan.Invalidated -> SignResult.Invalidated
        }
    }

    override suspend fun deleteKey() {
        withContext(Dispatchers.Default) {
            val store = keyStore()
            if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
        }
    }

    private sealed interface Scan {
        class Authenticated(val signature: Signature) : Scan
        data object Cancelled : Scan
        data object LockedOut : Scan
        data object Invalidated : Scan
    }

    /** On the main thread. Temporary problems (no activity, sensor busy) resume with an exception. */
    private suspend fun scan(signature: Signature, text: BiometricPromptText): Scan = suspendCancellableCoroutine { cont ->
        val host = activity() as? FragmentActivity ?: run {
            cont.resumeWithException(IllegalStateException("no FragmentActivity to show the biometric prompt over"))
            return@suspendCancellableCoroutine
        }
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authorized = result.cryptoObject?.signature
                if (authorized == null) {
                    cont.resumeWithException(IllegalStateException("prompt succeeded without the CryptoObject"))
                } else {
                    cont.resume(Scan.Authenticated(authorized))
                }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (!cont.isActive) return
                when (errorCode) {
                    BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                    BiometricPrompt.ERROR_CANCELED, BiometricPrompt.ERROR_TIMEOUT,
                    -> cont.resume(Scan.Cancelled)
                    BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> cont.resume(Scan.LockedOut)
                    BiometricPrompt.ERROR_NO_BIOMETRICS -> cont.resume(Scan.Invalidated) // all removed: the key is unusable
                    else -> cont.resumeWithException(IllegalStateException("biometric prompt error $errorCode")) // temporary
                }
            }

            // A finger that didn't match: the system prompt says so and keeps waiting.
            override fun onAuthenticationFailed() = Unit
        }
        val prompt = BiometricPrompt(host, ContextCompat.getMainExecutor(host), callback)
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(text.title)
            .apply { text.subtitle?.let(::setSubtitle) }
            .setNegativeButtonText(text.cancel)
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
        cont.invokeOnCancellation { prompt.cancelAuthentication() }
    }

    private fun generate(strongBox: Boolean) = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEY_STORE).run {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG) // every use, biometric only
        } else {
            @Suppress("DEPRECATION")
            spec.setUserAuthenticationValidityDurationSeconds(-1)
        }
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true)
        initialize(spec.build())
        generateKeyPair()
    }

    private fun kind(): BiometricKind {
        val pm = app.packageManager
        val kinds = buildList {
            if (pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) add(BiometricKind.FINGERPRINT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm.hasSystemFeature(PackageManager.FEATURE_FACE)) add(BiometricKind.FACE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm.hasSystemFeature(PackageManager.FEATURE_IRIS)) add(BiometricKind.IRIS)
        }
        return kinds.singleOrNull() ?: BiometricKind.OTHER
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    private companion object {
        const val ALIAS = "pocketly.biometric.v1"
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
    }
}
