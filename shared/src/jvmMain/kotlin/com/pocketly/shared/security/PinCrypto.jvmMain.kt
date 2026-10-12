package com.pocketly.shared.security

import java.security.NoSuchAlgorithmException
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

actual fun platformPinCrypto(): PinCrypto = JavaPinCrypto

/** javax.crypto (SunJCE). Same code as the Android actual. */
internal object JavaPinCrypto : PinCrypto {
    private val random = SecureRandom()

    override fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }

    override fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int, keyLength: Int): ByteArray {
        val factory = try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        } catch (_: NoSuchAlgorithmException) {
            return pbkdf2WithMac(password, salt, iterations, keyLength)
        }
        // PBEKeySpec takes chars; the PIN is ASCII, so each byte is one char.
        val chars = CharArray(password.size) { (password[it].toInt() and 0xff).toChar() }
        val spec = PBEKeySpec(chars, salt, iterations, keyLength * 8)
        try {
            return factory.generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
            chars.fill('\u0000')
        }
    }

    /** RFC 8018 §5.2 over HmacSHA256, for platforms without the PBKDF2 factory. */
    private fun pbkdf2WithMac(password: ByteArray, salt: ByteArray, iterations: Int, keyLength: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(password, "HmacSHA256")) }
        val out = ByteArray(keyLength)
        var block = 1
        var offset = 0
        while (offset < keyLength) {
            mac.update(salt)
            mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
            var u = mac.doFinal()
            val t = u.copyOf()
            repeat(iterations - 1) {
                u = mac.doFinal(u)
                for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
            }
            t.copyInto(out, offset, 0, minOf(t.size, keyLength - offset))
            offset += t.size
            block++
        }
        return out
    }
}
