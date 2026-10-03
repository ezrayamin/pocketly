package com.pocketly.shared.domain

/** Ledger rules. Mirrors packages/core-js/src/domain/ledger.ts. */
internal object Ledger {
    fun isOutgoing(type: TransactionType): Boolean =
        type == TransactionType.TRANSFER_OUT || type == TransactionType.QR_PAYMENT

    /**
     * FR-FAKE-06: the balance is derived from ledger entries.
     * Successful entries move money; pending outgoing entries hold funds; failed/reversed do nothing.
     */
    fun effect(tx: Transaction): Money = when (tx.status) {
        TransactionStatus.SUCCESS -> if (isOutgoing(tx.type)) -tx.amount else tx.amount
        TransactionStatus.PENDING -> if (isOutgoing(tx.type)) -tx.amount else Money.ZERO
        TransactionStatus.FAILED, TransactionStatus.REVERSED -> Money.ZERO
    }

    /** Counts toward the daily transfer limit (FR-TRF-10). */
    fun countsTowardDailyLimit(tx: Transaction): Boolean =
        isOutgoing(tx.type) && (tx.status == TransactionStatus.SUCCESS || tx.status == TransactionStatus.PENDING)
}
