package com.pocketly.shared.domain

enum class TransferState { DRAFT, AUTHORIZING, SUBMITTING, PENDING, SUCCESS, FAILED, REVERSED }

enum class TransferEvent {
    CONFIRM,
    CANCEL,
    AUTH_OK,
    SUBMIT_OK,
    SUBMIT_ERROR,
    TIMEOUT,
    RETRY,
    STATUS_SUCCESS,
    STATUS_FAILED,
    SERVER_REVERSAL,
}

class InvalidTransitionException(val from: TransferState, val event: TransferEvent) :
    IllegalStateException("Invalid transfer transition: $from --$event-->")

/**
 * requirements §3.2. The only place allowed transitions are defined (NFR-MONEY-04);
 * anything not listed here is invalid.
 */
object TransferStateMachine {
    private val transitions: Map<TransferState, Map<TransferEvent, TransferState>> = mapOf(
        TransferState.DRAFT to mapOf(TransferEvent.CONFIRM to TransferState.AUTHORIZING),
        TransferState.AUTHORIZING to mapOf(
            TransferEvent.CANCEL to TransferState.DRAFT,
            TransferEvent.AUTH_OK to TransferState.SUBMITTING,
        ),
        TransferState.SUBMITTING to mapOf(
            TransferEvent.SUBMIT_OK to TransferState.SUCCESS,
            TransferEvent.SUBMIT_ERROR to TransferState.FAILED,
            TransferEvent.TIMEOUT to TransferState.PENDING,
        ),
        TransferState.FAILED to mapOf(TransferEvent.RETRY to TransferState.SUBMITTING),
        TransferState.PENDING to mapOf(
            TransferEvent.STATUS_SUCCESS to TransferState.SUCCESS,
            TransferEvent.STATUS_FAILED to TransferState.FAILED,
        ),
        TransferState.SUCCESS to mapOf(TransferEvent.SERVER_REVERSAL to TransferState.REVERSED),
        TransferState.REVERSED to emptyMap(),
    )

    /** The next state, or null if the transition isn't allowed. */
    fun next(from: TransferState, event: TransferEvent): TransferState? = transitions[from]?.get(event)

    fun transition(from: TransferState, event: TransferEvent): TransferState =
        next(from, event) ?: throw InvalidTransitionException(from, event)
}
