package com.pocketly.shared.security

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.usePinned
import platform.CoreCrypto.CCKeyDerivationPBKDF
import platform.CoreCrypto.kCCPBKDF2
import platform.CoreCrypto.kCCPRFHmacAlgSHA256
import platform.CoreCrypto.kCCSuccess
import platform.Security.SecRandomCopyBytes
import platform.Security.errSecSuccess
import platform.Security.kSecRandomDefault

actual fun platformPinCrypto(): PinCrypto = CommonCryptoPinCrypto

/** CommonCrypto's PBKDF2 and the Security framework's generator. */
@OptIn(ExperimentalForeignApi::class)
internal object CommonCryptoPinCrypto : PinCrypto {
    override fun randomBytes(size: Int): ByteArray {
        val out = ByteArray(size)
        val status = out.usePinned { SecRandomCopyBytes(kSecRandomDefault, size.convert(), it.addressOf(0)) }
        check(status == errSecSuccess) { "SecRandomCopyBytes failed: $status" }
        return out
    }

    override fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int, keyLength: Int): ByteArray {
        val out = ByteArray(keyLength)
        // Kotlin/Native maps `const char *password` to String. The PIN is ASCII, so the bytes survive the trip.
        val text = password.decodeToString()
        check(text.encodeToByteArray().contentEquals(password)) { "password must be valid UTF-8" }
        val status = salt.usePinned { s ->
            out.usePinned { o ->
                CCKeyDerivationPBKDF(
                    kCCPBKDF2,
                    text,
                    password.size.convert(),
                    s.addressOf(0).reinterpret(),
                    salt.size.convert(),
                    kCCPRFHmacAlgSHA256,
                    iterations.convert(),
                    o.addressOf(0).reinterpret(),
                    keyLength.convert(),
                )
            }
        }
        check(status == kCCSuccess) { "CCKeyDerivationPBKDF failed: $status" }
        return out
    }
}
