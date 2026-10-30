package com.pocketly.shared.data

import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.OtpVerifyResult
import com.pocketly.shared.domain.TopUpMethod
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.Wallet

/** requirements §4.1 `TransferRequest`: what the idempotency key protects (ADR-0014). [note] is normalized. */
data class TransferRequest(val recipientId: String, val amount: Money, val note: String? = null)

/** ADR-0015: what a top-up's idempotency key protects. */
data class TopUpRequest(val method: TopUpMethod, val amount: Money)

/** ADR-0016: what a QR payment's idempotency key protects. */
data class QrPaymentRequest(val merchantId: String, val requestId: String?, val amount: Money)

/** ADR-0016 §4: what a scanned merchant code points at, from the server. [request]: dynamic code only. */
data class PaymentTarget(val merchant: Counterparty, val category: Category, val request: OpenPaymentRequest?)

data class OpenPaymentRequest(val id: String, val amount: Money, val expiresAt: Long)

/** One page of server changes, ordered by (updatedAt, id). */
data class ChangesPage(val items: List<Transaction>, val nextToken: String?, val hasMore: Boolean)

/**
 * Backend boundary (requirements §4.1, NFR-ARCH-03). Swapping FakeWalletApi for a real
 * implementation only changes `bridge/di/CoreModule.kt`. History reads the local replica
 * (ADR-0009), so the backend exposes a change feed instead of paged history.
 * payMerchant / incomingEvents() arrive with M4.
 * Mirrors packages/core-js/src/data/walletApi.ts.
 */
interface WalletApi {
    suspend fun getWallet(): Wallet

    /** Changes after [afterToken] (all, when null): the replica's delta sync. */
    suspend fun getChanges(afterToken: String?, limit: Int): ChangesPage
    suspend fun getTransaction(id: String): Transaction

    /** FR-AUTH-02 (ADR-0013): send a code by SMS. [phone] is E.164. */
    suspend fun requestOtp(phone: String): OtpSendResult

    /** FR-AUTH-02: the server checks the code and counts wrong ones; VERIFIED carries a session token. */
    suspend fun verifyOtp(phone: String, code: String): ServerOtpVerify

    /** FR-TRF-01: the server's users matching a name or phone (ContactSearch.match), sorted by name. */
    suspend fun searchContacts(query: String): List<Contact>

    /** One of the server's users, or NOT_FOUND. */
    suspend fun getContact(userId: String): Contact

    /**
     * FR-TRF-05 (ADR-0014 §2): applies the transfer once per key. The same key and request return
     * the recorded transaction in its current state (SUCCESS, FAILED or PENDING); a different
     * request is IDEMPOTENCY_CONFLICT. Business refusals come back as FAILED transactions.
     */
    suspend fun transfer(request: TransferRequest, idempotencyKey: String): Transaction

    /**
     * FR-TOP-02/03 (ADR-0015 §4): adds money once per key, from a mocked payment method. Recorded
     * PENDING on arrival, answered once processed: SUCCESS, or FAILED with PAYMENT_DECLINED. Keys
     * share [transfer]'s table, so a key used for either kind conflicts with the other.
     */
    suspend fun topUp(request: TopUpRequest, idempotencyKey: String): Transaction

    /**
     * ADR-0016 §4: the merchant (and its open, unexpired payment request). INVALID_QR for an unknown
     * merchant or request, or a request of another merchant; QR_EXPIRED; QR_ALREADY_PAID.
     */
    suspend fun getPaymentTarget(merchantId: String, requestId: String?): PaymentTarget

    /**
     * FR-QR-04 (ADR-0016 §4): as [transfer], for a merchant. A payment request is paid once: another
     * key for a paid request is QR_ALREADY_PAID; a refusal leaves it open.
     */
    suspend fun payMerchant(request: QrPaymentRequest, idempotencyKey: String): Transaction

    /**
     * ADR-0016 §6: the user id of the account verified with [phone], for sessions from before
     * verifyOtp returned it. A server that doesn't know the account yet (phone verified before it
     * recorded one) takes this phone as it; another phone than the account's is NOT_FOUND.
     */
    suspend fun getAccountUserId(phone: String): String

    /** FR-TRF-09 status check, any kind: the transaction recorded for this key, or NOT_FOUND (never arrived). */
    suspend fun getTransferByKey(idempotencyKey: String): Transaction
}

/** What the server answers on an OTP check: the result, plus a session token and the account's user id (ADR-0016 §6) when verified. */
data class ServerOtpVerify(val result: OtpVerifyResult, val sessionToken: String? = null, val userId: String? = null)

/** Developer-menu controls (FR-DEV-*). Only the fake backend implements this. */
interface FakeBackendControls {
    /** FR-DEV-05: reset to a seeded state. */
    fun reset(config: DatasetConfig)

    /** FR-DEV-04: the backend receives a deterministic incoming transfer, now. */
    fun simulateIncomingTransfer(): Transaction

    /** FR-DEV-02/03. */
    var networkSimulation: NetworkSimulation

    /** FR-TRF-10: the daily transfer limit, 0..MAX_AMOUNT_MINOR. Kept until reset. */
    fun setDailyLimit(minor: Money)
}
