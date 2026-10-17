package com.pocketly.bench

import com.pocketly.shared.bridge.CoreProbe
import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.IngestResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.concurrent.Volatile

/**
 * BenchCore for one kmpCore (packages/core-contract/src/bench.ts): benchmark-only entry points,
 * in perf builds only (this module is linked into kmpCorePerf alone). The Nitro adapter
 * packages/core-kmp-bench calls it. Counterpart of packages/core-js-bench.
 *
 * Everything measured is still the core's: ingest and batch formatting go through [CoreProbe]
 * to the core's own code and replica; only these entry points, the staged payload and the BM-10
 * what-if live here.
 */
class PocketlyBench(core: PocketlyCore) {
    private val probe = CoreProbe(core)

    /** BM-04b: a payload held on the Kotlin side, as a network response would be. Survives resetData. */
    @Volatile
    private var stagedPayload: String? = null

    /** BM-06: the pure cost of a call. No conversion, so only the crossing is timed. */
    fun echo(value: Double): Double = value

    fun formatMoneyBatch(minors: LongArray): List<String> = probe.formatMoneyBatch(minors)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun ingestTransactions(json: String): IngestResult = probe.ingestTransactions(json)

    fun stageIngestPayload(json: String) {
        stagedPayload = json
    }

    /** BM-04b: [ingestTransactions] on the staged payload, so nothing crosses the bridge in the call. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun ingestStaged(): IngestResult =
        ingestTransactions(stagedPayload ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "no ingest payload staged"))

    fun lastComputeMs(): Double = probe.lastComputeMs()

    fun lastStorageMs(): Double = probe.lastStorageMs()

    /** BM-10 what-if (ADR-0010 §8): pure-Kotlin PBKDF2, off the caller's thread. Never the PIN. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun pbkdf2WhatIf(password: String, saltHex: String, iterations: Int): String =
        withContext(Dispatchers.Default) { PurePbkdf2.sha256Hex(password, saltHex, iterations) }
}
