package com.pocketly.shared.security

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * CommonCrypto on the simulator. Vectors from packages/core-contract/fixtures/pin.json.
 * IosSecureStore isn't tested here: a bare test binary has no keychain (errSecNotAvailable).
 */
class IosSecurityTest {
    @Test
    fun pbkdf2MatchesTheFixtures() {
        val crypto = platformPinCrypto()
        assertEquals(
            "457849cec2fbbef4ff72b363da5f883a0384c67cd642c67f74ca85fc3cc48a83",
            PinPolicy.hash(crypto, "482915", "000102030405060708090a0b0c0d0e0f".hexToByteArray(), 1000).toHexString(),
        )
        assertEquals(
            "ca337843cf767fa6da82eab8dcbe203e3f46b7d7a10a096763041107ffe2dc42",
            PinPolicy.hash(crypto, "731048", "f1e2d3c4b5a69788796a5b4c3d2e1f00".hexToByteArray(), 600_000).toHexString(),
        )
        assertEquals(16, crypto.randomBytes(16).size)
    }
}
