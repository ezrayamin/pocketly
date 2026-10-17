package com.pocketly.shared.data.fake

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.TransferPolicy
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.concurrent.Volatile

/**
 * FR-FAKE-04: latency, failures and offline mode for the fake backend (developer menu).
 * Draw order is fixed (latency roll, then failure roll, for every NORMAL/SLOW/ALWAYS_FAIL
 * call; a delay roll, then an outcome roll, for a transfer in TIMEOUT mode) so both cores
 * produce the same sequence for the same seed.
 * Mirrors packages/core-js/src/data/fake/networkSimulator.ts.
 */
internal class NetworkSimulator {
    @Volatile
    private var simulation = NetworkSimulation.NORMAL
    private var rng = SeededRandom(1)
    private val rngLock = Mutex() // Kotlin runs backend calls in parallel; JS can't

    fun set(simulation: NetworkSimulation) {
        validate(simulation)
        this.simulation = simulation
        rng = SeededRandom(simulation.seed)
    }

    fun get(): NetworkSimulation = simulation

    /** FR-FAKE-05: how long the server holds a TIMEOUT-mode transfer as PENDING, and whether it then fails. */
    data class Hold(val holdMs: Long, val fails: Boolean)

    /**
     * Runs before a transfer reaches the server. In TIMEOUT mode the request arrives but its answer
     * never does: returns the [Hold]. Otherwise as [beforeCall], and returns null.
     */
    suspend fun beforeTransfer(): Hold? {
        val sim = simulation
        if (sim.mode != NetworkMode.TIMEOUT) {
            beforeCall()
            return null
        }
        return rngLock.withLock {
            val span = (TransferPolicy.PENDING_RESOLVE_MAX_MS - TransferPolicy.PENDING_RESOLVE_MIN_MS + 1).toInt()
            val holdMs = TransferPolicy.PENDING_RESOLVE_MIN_MS + rng.nextInt(span)
            Hold(holdMs, fails = rng.nextInt(100) < sim.failureRatePercent)
        }
    }

    /** Runs before every backend call: waits, then maybe fails. Never returns in TIMEOUT. */
    suspend fun beforeCall() {
        val sim = simulation
        when (sim.mode) {
            NetworkMode.OFFLINE -> throw CoreException(ErrorCode.NETWORK_UNAVAILABLE, "Simulated offline mode")
            NetworkMode.TIMEOUT -> awaitCancellation() // the client-side timeout ends the call
            else -> Unit
        }
        val (latencyRoll, failureRoll) = rngLock.withLock { nextRolls() }
        val latency = if (sim.mode == NetworkMode.SLOW) SLOW_LATENCY_MIN_MS + latencyRoll else sim.normalLatencyMs.toLong()
        if (latency > 0) delay(latency)
        if (sim.mode == NetworkMode.ALWAYS_FAIL || failureRoll < sim.failureRatePercent) {
            throw CoreException(ErrorCode.SERVER_ERROR, "Simulated server error")
        }
    }

    // Two draws per call, in a fixed order.
    private fun nextRolls(): Pair<Long, Int> {
        val latencyRoll = rng.nextInt((SLOW_LATENCY_MAX_MS - SLOW_LATENCY_MIN_MS + 1).toInt()).toLong()
        val failureRoll = rng.nextInt(100)
        return latencyRoll to failureRoll
    }

    private fun validate(s: NetworkSimulation) {
        if (s.failureRatePercent !in 0..100) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "failureRatePercent must be an integer 0..100")
        }
        if (s.normalLatencyMs !in 0..60_000) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "normalLatencyMs must be an integer 0..60000")
        }
        if (s.readTimeoutMs !in 100..60_000) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "readTimeoutMs must be an integer 100..60000")
        }
        if (s.writeTimeoutMs !in 100..60_000) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "writeTimeoutMs must be an integer 100..60000")
        }
    }

    companion object {
        const val SLOW_LATENCY_MIN_MS = 2_000L
        const val SLOW_LATENCY_MAX_MS = 5_000L
    }
}
