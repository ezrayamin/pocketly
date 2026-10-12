package com.pocketly.shared.security

import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.UnlockOutcome
import com.pocketly.shared.domain.UnlockResult
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Where the current install's id lives outside secure storage: somewhere the OS deletes with the
 * app (the replica's cache_meta). iOS keeps Keychain items across uninstalls; a mismatch means the
 * secrets belong to an earlier install and are wiped (ADR-0010).
 */
interface InstallMarker {
    suspend fun get(): String?
    suspend fun set(id: String)
}

/**
 * FR-AUTH-03/05 and FR-LOCK-04 over secure storage. Calls run one at a time (so two unlock
 * attempts can't both read the same counter) on [work], never the caller's thread: hashing takes
 * hundreds of milliseconds by design. Mirrors packages/core-js/src/security/pinAuth.ts.
 */
class PinAuthenticator(
    store: SecureStore,
    private val crypto: PinCrypto,
    private val marker: InstallMarker,
    private val work: CoroutineDispatcher,
    /** Device clock (lockouts). Tests inject one. */
    private val clock: () -> Long,
    /** Work factor for new records. Tests lower it; the app always uses [PinPolicy.ITERATIONS]. */
    private val iterations: Int = PinPolicy.ITERATIONS,
) {
    private val store: SecureStore = GuardedStore(store)
    private val mutex = Mutex()
    private var bound = false

    @Throws(CoreException::class, kotlin.coroutines.cancellation.CancellationException::class)
    suspend fun setPin(pin: String) {
        PinPolicy.check(pin).reason?.let { throw CoreException(ErrorCode.INVALID_ARGUMENT, "PIN refused: $it") }
        serial {
            store.put(KEY_PIN, newRecord(pin).encode())
            store.put(KEY_LOCKOUT, LockoutState.NONE.encode())
        }
    }

    @Throws(CoreException::class, kotlin.coroutines.cancellation.CancellationException::class)
    suspend fun verifyPin(pin: String): UnlockResult = serial {
        val record = readRecord() ?: throw CoreException(ErrorCode.NOT_FOUND, "no PIN set")
        val now = clock()
        val state = readLockout(now, pinSet = true)
        if (state.lockedUntil > now) return@serial UnlockResult(UnlockOutcome.LOCKED_OUT, 0, state.lockedUntil)

        // Count the attempt as wrong before hashing: killing the app mid-hash keeps the count.
        val failed = state.failedAttempts + 1
        val wrong = if (failed >= PinPolicy.MAX_ATTEMPTS) LockoutState(0, now + PinPolicy.LOCKOUT_MS) else LockoutState(failed, 0)
        store.put(KEY_LOCKOUT, wrong.encode())

        val hash = PinPolicy.hash(crypto, pin, record.salt, record.iterations)
        if (!constantTimeEquals(hash, record.hash)) {
            return@serial if (wrong.lockedUntil > 0) {
                UnlockResult(UnlockOutcome.LOCKED_OUT, 0, wrong.lockedUntil)
            } else {
                UnlockResult(UnlockOutcome.WRONG_PIN, PinPolicy.MAX_ATTEMPTS - failed)
            }
        }
        store.put(KEY_LOCKOUT, LockoutState.NONE.encode())
        if (record.iterations < iterations) {
            // The work factor went up since this PIN was set: re-hash while we know the PIN.
            store.put(KEY_PIN, newRecord(pin).encode())
        }
        UnlockResult(UnlockOutcome.UNLOCKED, PinPolicy.MAX_ATTEMPTS)
    }

    @Throws(CoreException::class, kotlin.coroutines.cancellation.CancellationException::class)
    suspend fun getAuthState(): AuthState = serial {
        val pinSet = readRecord() != null
        val now = clock()
        val state = readLockout(now, pinSet)
        AuthState(pinSet, state.failedAttempts, state.lockedUntil.takeIf { it > now })
    }

    @Throws(CoreException::class, kotlin.coroutines.cancellation.CancellationException::class)
    suspend fun resetAuth() = serial { wipe() }

    /** Runs [block] on [work] after every earlier call has finished, bound to this install. */
    private suspend fun <T> serial(block: suspend () -> T): T = withContext(work) {
        mutex.withLock {
            if (!bound) {
                bindToInstall()
                bound = true
            }
            block()
        }
    }

    private suspend fun bindToInstall() {
        val installed = marker.get()
        if (installed != null && installed == store.get(KEY_INSTALL_ID)) return
        // Secrets left by an earlier install (or none at all): start clean.
        store.clear()
        val id = installed ?: crypto.randomBytes(16).toHex().also { marker.set(it) }
        store.put(KEY_INSTALL_ID, id)
    }

    private suspend fun wipe() {
        store.clear()
        store.put(KEY_INSTALL_ID, marker.get()!!)
    }

    /** An unreadable record can't be verified against, so every secret goes and onboarding restarts. */
    private suspend fun readRecord(): PinRecord? {
        val encoded = store.get(KEY_PIN) ?: return null
        return PinRecord.decode(encoded) ?: run {
            wipe()
            null
        }
    }

    /**
     * Expired lockouts read as none. A counter that's unreadable, or missing while a PIN is set
     * ([setPin] always writes one), fails closed: a lockout from now.
     */
    private fun readLockout(now: Long, pinSet: Boolean): LockoutState {
        val encoded = store.get(KEY_LOCKOUT)
        if (encoded == null && !pinSet) return LockoutState.NONE
        val state = encoded?.let { LockoutState.decode(it) }
            ?: return LockoutState(0, now + PinPolicy.LOCKOUT_MS).also { store.put(KEY_LOCKOUT, it.encode()) }
        return if (state.lockedUntil != 0L && state.lockedUntil <= now) LockoutState.NONE else state
    }

    private fun newRecord(pin: String): PinRecord {
        val salt = crypto.randomBytes(PinPolicy.SALT_BYTES)
        return PinRecord(iterations, salt, PinPolicy.hash(crypto, pin, salt, iterations))
    }

    /**
     * Any store failure is "temporarily unavailable" (ADR-0010 §2.7): it becomes
     * SECURE_STORAGE_UNAVAILABLE and nothing is wiped. Wipes need positive evidence: a value the
     * store reports as gone, or a record that's present but can't be parsed.
     */
    private class GuardedStore(private val store: SecureStore) : SecureStore {
        override fun get(key: String) = guard { store.get(key) }
        override fun put(key: String, value: String) = guard { store.put(key, value) }
        override fun remove(key: String) = guard { store.remove(key) }
        override fun clear() = guard { store.clear() }

        private inline fun <T> guard(op: () -> T): T =
            try {
                op()
            } catch (e: Exception) {
                throw CoreException(ErrorCode.SECURE_STORAGE_UNAVAILABLE, "secure storage unavailable: ${e.message}")
            }
    }

    companion object {
        const val KEY_PIN = "pin"
        const val KEY_LOCKOUT = "lockout"
        const val KEY_INSTALL_ID = "installId"
    }
}
