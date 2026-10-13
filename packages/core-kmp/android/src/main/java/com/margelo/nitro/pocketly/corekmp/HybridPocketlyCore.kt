package com.margelo.nitro.pocketly.corekmp

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.bridge.Cancellable
import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.AndroidDatabaseDrivers
import com.pocketly.shared.security.AndroidBiometricSigner
import com.pocketly.shared.security.AndroidSecureStore

/**
 * Nitro adapter over the KMP facade. No business logic lives here: it only converts
 * arguments (JS Double → exact Long via [BridgeConversions]) and maps domain types to
 * Nitro structs (NitroMappers.kt). That mapping is part of the bridge overhead
 * that BM-03/04/06 measure.
 */
@DoNotStrip
@Keep
class HybridPocketlyCore : HybridPocketlyCoreSpec() {
    private val core: PocketlyCore = PocketlyCore.create(
        AndroidDatabaseDrivers(NitroModules.applicationContext!!),
        AndroidSecureStore(NitroModules.applicationContext!!),
        com.pocketly.shared.domain.DatasetConfig.LIVE,
        AndroidBiometricSigner(NitroModules.applicationContext!!) { NitroModules.applicationContext?.currentActivity },
    )

    override fun resetData(config: DatasetSeed, extraTransactions: Array<Transaction>): Promise<Unit> =
        Promise.async { core.resetData(config.toDomain(extraTransactions)) }

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

    override fun stageIngestPayload(json: String): Promise<Unit> =
        Promise.async { core.stageIngestPayload(json) }

    override fun ingestStaged(): Promise<IngestResult> =
        Promise.async { core.ingestStaged().toNitro() }

    override fun checkPin(pin: String): PinCheck = core.checkPin(pin).toNitro()

    override fun setPin(pin: String): Promise<Unit> = Promise.async { core.setPin(pin) }

    override fun verifyPin(pin: String): Promise<UnlockResult> = Promise.async { core.verifyPin(pin).toNitro() }

    override fun getAuthState(): Promise<AuthState> = Promise.async { core.getAuthState().toNitro() }

    override fun resetAuth(): Promise<Unit> = Promise.async { core.resetAuth() }

    override fun getAutoLockTimeout(): Promise<Double> = Promise.async { core.getAutoLockTimeout().toDouble() }

    override fun checkPhone(nationalNumber: String): PhoneCheck = core.checkPhone(nationalNumber).toNitro()

    override fun requestOtp(phone: String): Promise<OtpSendResult> = Promise.async { core.requestOtp(phone).toNitro() }

    override fun verifyOtp(phone: String, code: String): Promise<OtpVerifyResult> =
        Promise.async { core.verifyOtp(phone, code).toNitro() }

    override fun getBiometricStatus(): Promise<BiometricStatus> = Promise.async { core.getBiometricStatus().toNitro() }

    override fun enableBiometrics(pin: String, prompt: BiometricPromptText): Promise<BiometricEnableResult> =
        Promise.async { core.enableBiometrics(pin, prompt.toDomain()).toNitro() }

    override fun disableBiometrics(): Promise<Unit> = Promise.async { core.disableBiometrics() }

    override fun unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlockResult> =
        Promise.async { core.unlockWithBiometrics(prompt.toDomain()).toNitro() }

    // Converted inside the promise: a bad value rejects (INVALID_ARGUMENT), as in jsCore.
    override fun setAutoLockTimeout(ms: Double): Promise<Unit> =
        Promise.async { core.setAutoLockTimeout(BridgeConversions.toLongExact(ms, "ms")) }

    override fun echo(value: Double): Double = core.echo(value)

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

    override fun lastStorageMs(): Double = core.lastStorageMs()
}

@DoNotStrip
@Keep
class HybridPriceSubscription(private val cancellable: Cancellable) : HybridPriceSubscriptionSpec() {
    override fun unsubscribe() = cancellable.cancel()
}
