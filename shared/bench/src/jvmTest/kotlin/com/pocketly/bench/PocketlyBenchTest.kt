package com.pocketly.bench

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.security.MemorySecureStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** The contract suite's bench blocks that aren't BM-10: echo (BM-06) and the staged ingest (BM-04b). */
class PocketlyBenchTest {
    private val ingest = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "ingest.json").readText(),
    ).jsonObject

    private lateinit var core: PocketlyCore
    private lateinit var bench: PocketlyBench

    @BeforeTest
    fun setUp() = runTest {
        core = PocketlyCore.create(JvmDatabaseDrivers(), MemorySecureStore())
        core.resetData(DatasetConfig.DEFAULT)
        bench = PocketlyBench(core)
    }

    @Test
    fun echoReturnsItsArgument() {
        for (v in listOf(0.0, -1.5, 42.0, 9_007_199_254_740_991.0)) assertEquals(v, bench.echo(v))
    }

    @Test
    fun ingestStagedUsesTheStagedPayloadAndKeepsIt() = runTest {
        assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { bench.ingestStaged() }.code)
        bench.stageIngestPayload(ingest["input"].toString())
        core.resetData(DatasetConfig.DEFAULT) // the staged payload is the bench's, not the database's
        val expected = ingest["expected"]!!.jsonObject
        assertEquals(expected["accepted"]!!.jsonPrimitive.int, bench.ingestStaged().accepted)
        assertEquals("Iced latte", core.getTransaction("ing-0001").note)
        assertEquals(0, bench.ingestStaged().accepted) // still staged: only duplicates now
        assertEquals(true, bench.lastStorageMs() >= 0.0)
    }
}
