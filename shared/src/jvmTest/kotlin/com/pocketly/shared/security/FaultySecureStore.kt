package com.pocketly.shared.security

/**
 * A secure store that fails the two ways a real one can (ADR-0010 §2.7). Mirrors
 * packages/core-js/testing/faultySecureStore.ts.
 */
class FaultySecureStore : SecureStore {
    val values = LinkedHashMap<String, String>()

    /** Temporarily unavailable, as while the device is locked: every call throws. */
    var unavailable = false

    /** put() of these keys throws (temporarily unavailable). */
    val failingWrites = mutableSetOf<String>()

    /** get() of these keys finds them permanently unreadable: deleted, reported absent. */
    val unreadable = mutableSetOf<String>()

    override fun get(key: String): String? {
        check()
        if (key in unreadable) {
            values.remove(key)
            return null
        }
        return values[key]
    }

    override fun put(key: String, value: String) {
        check()
        if (key in failingWrites) throw IllegalStateException("write of $key failed: Keystore busy")
        values[key] = value
    }

    override fun remove(key: String) {
        check()
        values.remove(key)
    }

    override fun clear() {
        check()
        values.clear()
    }

    private fun check() {
        if (unavailable) throw IllegalStateException("device locked: errSecInteractionNotAllowed")
    }
}
