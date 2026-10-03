package com.pocketly.shared.security

/**
 * Secrets storage (NFR-SEC-01): PIN hash, tokens. Never holds financial data.
 *
 * Placeholder for M3 (Auth & App Lock): the `actual` implementations will be
 * Keystore-backed on Android and Keychain-backed on iOS, provided through `expect`/`actual`.
 * Benchmarks don't touch this layer.
 */
interface SecureStore {
    fun put(key: String, value: ByteArray)
    fun get(key: String): ByteArray?
    fun remove(key: String)
}
