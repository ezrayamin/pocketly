package com.pocketly.shared.bridge

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.IngestResult
import kotlinx.coroutines.CancellationException

/**
 * Benchmark-only access to one core, for the `pocketly-shared-bench` module (perf builds,
 * benchmarking.md §5.2). It reaches the core's replica and timings, which the core keeps internal.
 * Release code never calls it, so R8 removes it, and the ingest path only it reaches, from
 * release APKs (benchmarks/scripts/check-release-clean.sh checks the mapping).
 */
class CoreProbe(private val core: PocketlyCore) {
    /** Time inside the core of the most recent computeSpendingSummary, ingest or batch format. */
    fun lastComputeMs(): Double = core.computeMs

    /** Database time of that same call (ADR-0009: the engines differ between builds). */
    fun lastStorageMs(): Double = core.storageMs

    /** BM-04: the core's validator, then its replica; compute and storage timed separately. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun ingestTransactions(json: String): IngestResult = core.ingestTransactions(json)

    /** BM-06 batched: the core's formatMoney over every amount, timed as compute. */
    fun formatMoneyBatch(minors: LongArray): List<String> = core.formatMoneyBatch(minors)
}
