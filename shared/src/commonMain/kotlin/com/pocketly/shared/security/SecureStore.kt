package com.pocketly.shared.security

/**
 * Secrets storage (NFR-SEC-01, ADR-0010): the PIN record, the attempt counter, the install id.
 * Never holds financial data. Calls block; [PinAuthenticator] makes them off the JS thread.
 *
 * Two kinds of failure, kept apart because only one may lead to a wipe (ADR-0010 §2.7):
 *  - permanently unreadable (key invalidated or deleted, value tampered with): [get] deletes the
 *    value and returns null, exactly as if it had never been written;
 *  - temporarily unavailable (device locked, Keystore busy, anything else): the call throws.
 *    Nothing is lost; callers stay locked and try again later.
 *  - Android: [AndroidSecureStore] (AES-256-GCM under an AndroidKeyStore key)
 *  - iOS: [IosSecureStore] (Keychain, when unlocked, this device only)
 *  - JVM tests: [MemorySecureStore]
 * Counterpart of packages/core-js/src/security/secureStore.ts.
 */
interface SecureStore {
    /** null when the key is absent or permanently unreadable (then it's deleted). Throws when temporarily unavailable. */
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
    /** Deletes every key this store holds. */
    fun clear()
}

class MemorySecureStore : SecureStore {
    val values = LinkedHashMap<String, String>()

    override fun get(key: String): String? = values[key]

    override fun put(key: String, value: String) {
        values[key] = value
    }

    override fun remove(key: String) {
        values.remove(key)
    }

    override fun clear() = values.clear()
}
