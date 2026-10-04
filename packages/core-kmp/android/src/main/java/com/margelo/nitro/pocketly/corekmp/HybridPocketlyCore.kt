package com.margelo.nitro.pocketly.corekmp

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.Promise
import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.bridge.Cancellable
import com.pocketly.shared.bridge.PocketlyCore

/**
 * Nitro adapter over the KMP facade. No business logic lives here: it only converts
 * arguments (JS Double → exact Long via [BridgeConversions]) and maps domain types to
 * Nitro structs (NitroMappers.kt). That mapping is part of the bridge overhead
 * that BM-03/04/06 measure.
 */
@DoNotStrip
@Keep
class HybridPocketlyCore : HybridPocketlyCoreSpec() {
    private val core: PocketlyCore = PocketlyCore.create(com.pocketly.shared.domain.DatasetConfig.LIVE)

    override fun resetData(config: DatasetConfig): Promise<Unit> = Promise.async {
        core.resetData(config.toDomain())
    }

    override fun getWallet(): Promise<Wallet> = Promise.async { core.getWallet().toNitro() }

    override fun getTransactions(cursor: String?, limit: Double, filter: TxFilter?): Promise<TransactionPage> =
        Promise.async {
            core.getTransactions(cursor, BridgeConversions.toIntExact(limit, "limit"), filter?.toDomain()).toNitro()
        }

    override fun getTransaction(id: String): Promise<Transaction> =
        Promise.async { core.getTransaction(id).toNitro() }

    override fun setNetworkSimulation(simulation: NetworkSimulation) = core.setNetworkSimulation(simulation.toDomain())

    override fun getNetworkSimulation(): NetworkSimulation = core.getNetworkSimulation().toNitro()

    override fun simulateIncomingTransfer(): Promise<Transaction> =
        Promise.async { core.simulateIncomingTransfer().toNitro() }

    override fun setTimeZone(zoneId: String) = core.setTimeZone(zoneId)

    override fun computeSpendingSummary(month: String): Promise<SpendingSummary> =
        Promise.async { core.computeSpendingSummary(month).toNitro() }

    override fun ingestTransactions(json: String): Promise<IngestResult> =
        Promise.async { core.ingestTransactions(json).toNitro() }

    override fun formatMoney(minor: Double): String = core.formatMoney(BridgeConversions.toLongExact(minor))

    override fun formatMoneyBatch(minors: DoubleArray): Array<String> =
        core.formatMoneyBatch(BridgeConversions.toLongArrayExact(minors)).toTypedArray()

    override fun parseMoney(input: String): MoneyParseResult = core.parseMoney(input).toNitro()

    override fun subscribePrices(
        symbols: Array<String>,
        intervalMs: Double,
        seed: Double,
        onTicks: (ticks: Array<PriceTick>) -> Unit,
    ): HybridPriceSubscriptionSpec {
        val cancellable = core.subscribePrices(
            symbols.toList(),
            BridgeConversions.toLongExact(intervalMs, "intervalMs"),
            BridgeConversions.toIntExact(seed, "seed"),
        ) { ticks -> onTicks(Array(ticks.size) { ticks[it].toNitro() }) }
        return HybridPriceSubscription(cancellable)
    }

    override fun lastComputeMs(): Double = core.lastComputeMs()
}

@DoNotStrip
@Keep
class HybridPriceSubscription(private val cancellable: Cancellable) : HybridPriceSubscriptionSpec() {
    override fun unsubscribe() = cancellable.cancel()
}
