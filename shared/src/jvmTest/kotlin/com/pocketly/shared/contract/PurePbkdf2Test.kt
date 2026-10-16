package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.security.PurePbkdf2
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** BM-10 (ADR-0010 §8): the contract suite's "pbkdf2WhatIf" block, against fixtures/pin.json. */
class PurePbkdf2Test {
    private val vectors = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "pin.json").readText(),
    ).jsonObject["pbkdf2"]!!.jsonArray.map { it.jsonObject }

    private val core = PocketlyCore.create(JvmDatabaseDrivers(), MemorySecureStore())

    @Test
    fun matchesTheFixtureVectors() = runTest {
        for (v in vectors) {
            val iterations = v["iterations"]!!.jsonPrimitive.int
            assertEquals(
                v["hashHex"]!!.jsonPrimitive.content,
                core.pbkdf2WhatIf(v["pin"]!!.jsonPrimitive.content, v["saltHex"]!!.jsonPrimitive.content, iterations),
                "$iterations iterations",
            )
        }
    }

    @Test
    fun rejectsBadArguments() = runTest {
        val cases = listOf(
            Triple("４８２９１５", "00", 1),
            Triple("482915", "AB", 1),
            Triple("482915", "abc", 1),
            Triple("482915", "00", 0),
            Triple("482915", "00", PurePbkdf2.MAX_ITERATIONS + 1),
        )
        for ((password, salt, iterations) in cases) {
            val e = assertFailsWith<CoreException>("$password $salt $iterations") { core.pbkdf2WhatIf(password, salt, iterations) }
            assertEquals(ErrorCode.INVALID_ARGUMENT, e.code)
        }
    }

    @Test
    fun maxIterationsMatchesTheContract() {
        // packages/core-contract/src/constants.ts BM10_MAX_ITERATIONS
        val constants = File(System.getProperty("pocketly.fixtures")!!, "../src/constants.ts").readText()
        assertEquals(
            PurePbkdf2.MAX_ITERATIONS,
            Regex("BM10_MAX_ITERATIONS = ([0-9_]+)").find(constants)!!.groupValues[1].replace("_", "").toInt(),
        )
    }
}
