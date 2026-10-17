package com.pocketly.shared.security

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * kmpCore's secure storage on Android (ADR-0010): values are encrypted with AES-256-GCM under a
 * non-exportable AndroidKeyStore key (TEE-backed where the device has one; usable only while the
 * device is unlocked if it has a secure lock screen) and kept in SharedPreferences
 * `pocketly.secure`, which is excluded from backups and device transfers. Each value's key name
 * is its AAD, so a value can't be moved to another key. Writes are synchronous (`commit`): the
 * attempt counter must be on disk before the PIN is hashed.
 */
class AndroidSecureStore(context: Context) : SecureStore {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    override fun get(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return try {
            val (iv, sealed) = stored.split(':').map { Base64.decode(it, Base64.NO_WRAP) }
            val cipher = Cipher.getInstance(TRANSFORMATION)
            val secretKey = existingKey() ?: return if (deviceLocked()) error("device locked") else dropUnreadable(key)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
            cipher.updateAAD(key.encodeToByteArray())
            cipher.doFinal(sealed).decodeToString()
        } catch (e: Exception) {
            // While the device is locked the key refuses to work by design (unlocked device
            // required): whatever the exception says, that's temporary. Never drop anything then.
            if (deviceLocked()) throw e
            if (e is AEADBadTagException || e is KeyPermanentlyInvalidatedException ||
                e is UnrecoverableKeyException || e is IllegalArgumentException || e is IndexOutOfBoundsException
            ) {
                dropUnreadable(key) // tampered with, or the key is gone: unreadable for good
            } else {
                throw e // temporarily unavailable (Keystore busy, …)
            }
        }
    }

    @Synchronized
    override fun put(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: generateKey())
        cipher.updateAAD(key.encodeToByteArray())
        val sealed = cipher.doFinal(value.encodeToByteArray())
        val encoded = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP)
        check(prefs.edit().putString(key, encoded).commit()) { "secure store write failed" }
    }

    @Synchronized
    override fun remove(key: String) {
        check(prefs.edit().remove(key).commit()) { "secure store write failed" }
    }

    /** Deletes the values and the Keystore key; the next write makes a new key. */
    @Synchronized
    override fun clear() {
        check(prefs.edit().clear().commit()) { "secure store write failed" }
        keyStore().deleteEntry(ALIAS)
    }

    private fun deviceLocked(): Boolean = app.getSystemService(KeyguardManager::class.java).isDeviceLocked

    private fun dropUnreadable(key: String): String? {
        remove(key)
        return null
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(ALIAS, null) as SecretKey?

    private fun generateKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
        // Without a secure lock screen this throws on Android 12–14 (same rule as sensitive-info).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && app.getSystemService(KeyguardManager::class.java).isDeviceSecure) {
            spec.setUnlockedDeviceRequired(true)
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
            .apply { init(spec.build()) }
            .generateKey()
    }

    private companion object {
        const val PREFS = "pocketly.secure"
        const val ALIAS = "pocketly.secure.v1"
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
