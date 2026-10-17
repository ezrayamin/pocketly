package com.pocketly.shared.security

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.usePinned
import platform.CoreFoundation.CFDataCreate
import platform.CoreFoundation.CFDataRef
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Security.SecKeyCreateWithData
import platform.Security.SecKeyVerifySignature
import platform.Security.kSecAttrKeyClass
import platform.Security.kSecAttrKeyClassPublic
import platform.Security.kSecAttrKeyType
import platform.Security.kSecAttrKeyTypeECSECPrimeRandom
import platform.Security.kSecKeyAlgorithmECDSASignatureMessageX962SHA256
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

    /** SPKI DER for P-256 = this fixed 26-byte header + the 65-byte uncompressed point. */
    private val P256_SPKI_HEADER = byteArrayOf(
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x02, 0x01,
        0x06, 0x08, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    )

    override fun verifyP256(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != P256_SPKI_HEADER.size + 65 || !publicKey.copyOf(P256_SPKI_HEADER.size).contentEquals(P256_SPKI_HEADER)) return false
        if (message.isEmpty() || signature.isEmpty()) return false
        val point = publicKey.copyOfRange(P256_SPKI_HEADER.size, publicKey.size)
        return memScoped {
            val pointData = point.toCFData()
            val messageData = message.toCFData()
            val signatureData = signature.toCFData()
            val attributes = CFDictionaryCreateMutable(null, 2, kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)
            CFDictionaryAddValue(attributes, kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom)
            CFDictionaryAddValue(attributes, kSecAttrKeyClass, kSecAttrKeyClassPublic)
            try {
                val key = SecKeyCreateWithData(pointData, attributes, null) ?: return@memScoped false
                try {
                    SecKeyVerifySignature(key, kSecKeyAlgorithmECDSASignatureMessageX962SHA256, messageData, signatureData, null)
                } finally {
                    CFRelease(key)
                }
            } finally {
                CFRelease(attributes)
                CFRelease(pointData)
                CFRelease(messageData)
                CFRelease(signatureData)
            }
        }
    }

    private fun ByteArray.toCFData(): CFDataRef? = usePinned { CFDataCreate(null, it.addressOf(0).reinterpret(), size.convert()) }
}
