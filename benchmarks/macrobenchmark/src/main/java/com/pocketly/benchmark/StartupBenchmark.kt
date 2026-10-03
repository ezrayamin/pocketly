package com.pocketly.benchmark

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * BM-01: cold start → Home rendered (DEFAULT_DATASET, 200 transactions).
 *  - timeToInitialDisplayMs: first frame of MainActivity
 *  - timeToFullDisplayMs:    JS called reportFullyDrawn() after wallet + recent txs rendered
 *
 * Instrumentation args:
 *  targetPackage  com.pocketly.js | com.pocketly.kmp   (required)
 *  iterations     default 1 (benchmarks/scripts/bm-01-startup.sh alternates builds per iteration)
 *  compilation    none (BM-01, default) | baselineProfile (BM-09)
 */
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule
    val rule = MacrobenchmarkRule()

    private val args = InstrumentationRegistry.getArguments()
    private val targetPackage = requireNotNull(args.getString("targetPackage")) { "-e targetPackage is required" }
    private val iterations = args.getString("iterations")?.toInt() ?: 1
    private val compilationMode = when (args.getString("compilation") ?: "none") {
        "none" -> CompilationMode.None()
        "baselineProfile" -> CompilationMode.Partial(BaselineProfileMode.Require)
        else -> error("compilation must be none|baselineProfile")
    }

    @Test
    fun coldStartup() = rule.measureRepeated(
        packageName = targetPackage,
        metrics = listOf(StartupTimingMetric()),
        compilationMode = compilationMode,
        startupMode = StartupMode.COLD,
        iterations = iterations,
    ) {
        pressHome()
        startActivityAndWait()
        // Home is "rendered" once the balance shows a formatted amount.
        val drawn = device.wait(Until.hasObject(By.res("balance").textStartsWith("$")), 10_000)
        assertTrue("Home never rendered a balance in $targetPackage", drawn)
    }
}
