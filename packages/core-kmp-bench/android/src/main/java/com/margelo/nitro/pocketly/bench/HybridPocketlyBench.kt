package com.margelo.nitro.pocketly.bench

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.Promise
import com.margelo.nitro.pocketly.corekmp.HybridPocketlyCore
import com.pocketly.bench.PocketlyBench
import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.domain.IngestResult as KIngestResult

/**
 * Nitro adapter over shared/bench's [PocketlyBench] (perf builds only). Works on the process's
 * one core, the instance `PocketlyCore` created, so BenchCore reads and writes that core's
 * replica and timings. Thin, like HybridPocketlyCore: argument conversion and struct mapping only.
 */
@DoNotStrip
@Keep
class HybridPocketlyBench : HybridPocketlyBenchSpec() {
    private val bench = PocketlyBench(
        HybridPocketlyCore.current ?: error("PocketlyBench needs PocketlyCore: create the core first"),
    )

    override fun echo(value: Double): Double = bench.echo(value)

    override fun formatMoneyBatch(minors: DoubleArray): Array<String> =
        bench.formatMoneyBatch(BridgeConversions.toLongArrayExact(minors)).toTypedArray()

    override fun ingestTransactions(json: String): Promise<IngestResult> =
        Promise.async { bench.ingestTransactions(json).toNitro() }

    override fun stageIngestPayload(json: String): Promise<Unit> =
        Promise.async { bench.stageIngestPayload(json) }

    override fun ingestStaged(): Promise<IngestResult> =
        Promise.async { bench.ingestStaged().toNitro() }

    override fun lastComputeMs(): Double = bench.lastComputeMs()

    override fun lastStorageMs(): Double = bench.lastStorageMs()

    override fun pbkdf2WhatIf(password: String, saltHex: String, iterations: Double): Promise<String> =
        Promise.async { bench.pbkdf2WhatIf(password, saltHex, BridgeConversions.toIntExact(iterations, "iterations")) }
}

private fun KIngestResult.toNitro() = IngestResult(
    accepted = accepted.toDouble(),
    rejected = rejected.toDouble(),
    duplicates = duplicates.toDouble(),
    errors = Array(errors.size) { IngestError(errors[it].index.toDouble(), IngestRejectReason.valueOf(errors[it].reason.name)) },
)
