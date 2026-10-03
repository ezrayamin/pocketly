package com.pocketly.shared.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** NFR-TEST-03. The JSON-fixture version of this lives in jvmTest/ContractFixturesTest. */
class TransferStateMachineTest {
    private val allowed = mapOf(
        (TransferState.DRAFT to TransferEvent.CONFIRM) to TransferState.AUTHORIZING,
        (TransferState.AUTHORIZING to TransferEvent.CANCEL) to TransferState.DRAFT,
        (TransferState.AUTHORIZING to TransferEvent.AUTH_OK) to TransferState.SUBMITTING,
        (TransferState.SUBMITTING to TransferEvent.SUBMIT_OK) to TransferState.SUCCESS,
        (TransferState.SUBMITTING to TransferEvent.SUBMIT_ERROR) to TransferState.FAILED,
        (TransferState.SUBMITTING to TransferEvent.TIMEOUT) to TransferState.PENDING,
        (TransferState.FAILED to TransferEvent.RETRY) to TransferState.SUBMITTING,
        (TransferState.PENDING to TransferEvent.STATUS_SUCCESS) to TransferState.SUCCESS,
        (TransferState.PENDING to TransferEvent.STATUS_FAILED) to TransferState.FAILED,
        (TransferState.SUCCESS to TransferEvent.SERVER_REVERSAL) to TransferState.REVERSED,
    )

    @Test
    fun everyStateEventPairIsCovered() {
        for (state in TransferState.entries) {
            for (event in TransferEvent.entries) {
                val expected = allowed[state to event]
                assertEquals(expected, TransferStateMachine.next(state, event), "$state --$event-->")
                if (expected == null) {
                    assertFailsWith<InvalidTransitionException> { TransferStateMachine.transition(state, event) }
                }
            }
        }
    }

    @Test
    fun retryReusesSubmittingPath() {
        var s = TransferState.DRAFT
        for (e in listOf(TransferEvent.CONFIRM, TransferEvent.AUTH_OK, TransferEvent.SUBMIT_ERROR, TransferEvent.RETRY)) {
            s = TransferStateMachine.transition(s, e)
        }
        assertEquals(TransferState.SUBMITTING, s)
        assertNull(TransferStateMachine.next(TransferState.REVERSED, TransferEvent.RETRY))
    }
}
