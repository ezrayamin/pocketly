package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.BiometricEnableOutcome
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransferAuth
import com.pocketly.shared.domain.TransferAuthMethod
import com.pocketly.shared.domain.TransferAuthOutcome
import com.pocketly.shared.domain.TransferResult
import com.pocketly.shared.domain.TransferState
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.security.BiometricMessages
import com.pocketly.shared.security.FakeBiometricSigner
import com.pocketly.shared.security.FakeBiometricSigner.Scan
import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.sync.TransferFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * ADR-0014 §3 (biometric confirmation) and NFR-REL-03 (restart while PENDING): the parts the
 * contract suite can't script. Same cases as packages/core-js/__tests__/transferFlow.test.ts.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TransferFlowTest {
    private lateinit var signer: FakeBiometricSigner
    private lateinit var core: PocketlyCore
    private val biometric = TransferAuth(TransferAuthMethod.BIOMETRIC, prompt = PROMPT)

    @BeforeTest
    fun setUp() = runBlocking {
        signer = FakeBiometricSigner()
        core = PocketlyCore.create(
            JvmDatabaseDrivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), MemorySecureStore(),
            pinIterations = 1000, biometricSigner = signer,
        )
        core.resetData(DatasetConfig.DEFAULT)
        core.verifyTestPhone()
        core.setPin(PIN)
        assertEquals(BiometricEnableOutcome.ENABLED, core.enableBiometrics(PIN, PROMPT).outcome)
    }

    private suspend fun review() = core.startTransfer("u-01").let { core.reviewTransfer(Money(15_000), "Dinner") }

    @Test
    fun idempotencyKeysAreVersion4() {
        assertEquals("ffffffff-ffff-4fff-bfff-ffffffffffff", TransferFlow.uuidV4(ByteArray(16) { -1 }))
        assertEquals("00000000-0000-4000-8000-000000000000", TransferFlow.uuidV4(ByteArray(16)))
    }

    @Test
    fun signsExactlyThisAttemptsTransferMessageThenSends() = runBlocking {
        val r = review()
        val result = core.confirmTransfer(r.id, biometric)
        assertEquals(TransferState.SUCCESS to TransferAuthOutcome.OK, result.state to result.auth)
        assertEquals(BiometricMessages.transfer(15_000, "u-01", r.idempotencyKey), signer.messages.last())
        assertEquals(PROMPT, signer.prompts.last())
    }

    @Test
    fun cancelReturnsToReviewWithNothingSentThePinStillWorksAfter() = runBlocking {
        val r = review()
        signer.scans += Scan.CANCEL
        assertEquals(TransferResult(r.id, TransferState.DRAFT, TransferAuthOutcome.CANCELLED), core.confirmTransfer(r.id, biometric))
        assertEquals(1_459_085, core.getWallet().balance.minor)
        assertEquals(TransferState.SUCCESS, core.confirmTransfer(r.id, TransferAuth(TransferAuthMethod.PIN, pin = PIN)).state)
    }

    @Test
    fun aBiometricLockoutOrABusySensorChangesNothing() = runBlocking {
        val r = review()
        signer.scans += listOf(Scan.LOCKOUT, Scan.DEVICE_LOCKED)
        assertEquals(TransferAuthOutcome.BIOMETRIC_LOCKED_OUT, core.confirmTransfer(r.id, biometric).auth)
        assertEquals(TransferAuthOutcome.UNAVAILABLE, core.confirmTransfer(r.id, biometric).auth)
        assertEquals(true, core.getBiometricStatus().enabled)
    }

    @Test
    fun aPermanentFailureTurnsBiometricsOffAndSendsNothing() = runBlocking {
        for ((scan, outcome) in listOf(Scan.INVALIDATED to TransferAuthOutcome.KEY_INVALIDATED, Scan.OTHER_KEY to TransferAuthOutcome.FAILED)) {
            if (!core.getBiometricStatus().enabled) assertEquals(BiometricEnableOutcome.ENABLED, core.enableBiometrics(PIN, PROMPT).outcome)
            val r = review()
            signer.scans += scan
            assertEquals(TransferResult(r.id, TransferState.DRAFT, outcome), core.confirmTransfer(r.id, biometric), scan.name)
            assertEquals(false, core.getBiometricStatus().enabled)
            assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.confirmTransfer(r.id, biometric) }.code)
            assertEquals(1_459_085, core.getWallet().balance.minor)
        }
    }

    @Test
    fun anUnlockSignatureCantApproveATransfer() = runBlocking {
        core.unlockWithBiometrics(PROMPT)
        val r = review()
        signer.scans += Scan.REPLAY
        assertEquals(TransferAuthOutcome.FAILED, core.confirmTransfer(r.id, biometric).auth)
    }

    @Test
    fun aDoubleTapShowsOnePrompt() = runBlocking {
        val r = review()
        val before = signer.prompts.size
        val (a, b) = listOf(async { core.confirmTransfer(r.id, biometric) }, async { core.confirmTransfer(r.id, biometric) }).awaitAll()
        assertEquals(a, b)
        assertEquals(1, signer.prompts.size - before)
    }

    @Test
    fun restartWhilePendingThePendingRowStaysAndItsKeySettlesIt() = runBlocking {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val drivers = { JvmDatabaseDrivers(dir.resolve("server.db").path, dir.resolve("cache.db").path) }
        val store = MemorySecureStore()
        val first = PocketlyCore.create(drivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), store, pinIterations = 1000)
        first.resetData(DatasetConfig.DEFAULT)
        first.verifyTestPhone()
        first.setPin(PIN)
        first.startTransfer("u-03")
        val r = first.reviewTransfer(Money(8_000), null)
        first.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 0, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, first.confirmTransfer(r.id, TransferAuth(TransferAuthMethod.PIN, pin = PIN)).state)

        val second = PocketlyCore.create(drivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), store, pinIterations = 1000)
        second.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, 0))
        val offline = second.getTransactions(null, 20, TxFilter(statuses = listOf(TransactionStatus.PENDING)))
        assertEquals("local-${r.idempotencyKey}", offline.items.first { it.idempotencyKey == r.idempotencyKey }.id)

        second.setNetworkSimulation(NetworkSimulation.NORMAL)
        assertEquals(TransferState.PENDING, second.getTransferStatus(r.id).state)
        second.advanceServerClock(20_000)
        val settled = second.getTransferStatus(r.id)
        assertEquals(TransferState.SUCCESS to "trf-1", settled.state to settled.transaction?.id)
    }

    private companion object {
        const val PIN = "482915"
        val PROMPT = BiometricPromptText("Confirm transfer", "Send $150.00 to Andi Pratama", "Use PIN")
    }
}
