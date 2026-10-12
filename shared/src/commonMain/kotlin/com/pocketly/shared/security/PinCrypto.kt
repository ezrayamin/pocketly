package com.pocketly.shared.security

/**
 * The crypto primitives the PIN needs (ADR-0010), from the platform: javax.crypto on Android
 * and the JVM, CommonCrypto and SecRandomCopyBytes on iOS.
 * Counterpart of packages/core-js/src/security/pinCrypto.ts.
 */
interface PinCrypto {
    /** From a cryptographically secure generator. */
    fun randomBytes(size: Int): ByteArray

    /** PBKDF2-HMAC-SHA256. Blocks for as long as the work factor says: never call it on the JS thread. */
    fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int, keyLength: Int): ByteArray
}

expect fun platformPinCrypto(): PinCrypto

/** Constant time for equal lengths: every byte is compared, whatever the first difference. */
internal fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
    if (a.size != b.size) return false
    var diff = 0
    for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
    return diff == 0
}
