package com.pocketly.shared.sync

import com.pocketly.shared.data.fake.SeededRandom
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.PriceTick
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlin.math.max

/**
 * Deterministic simulated price feed (BM-05). The real WebSocket feed (F10) will sit
 * behind the same Flow. Mirrors packages/core-js/src/sync/priceFeed.ts.
 */
internal class PriceFeed(private val symbols: List<String>, seed: Int) {
    private val rng = SeededRandom(seed)
    private val prices = LongArray(symbols.size) { BASE_PRICES[symbols[it]] ?: DEFAULT_BASE_PRICE }
    private var seq = 0

    fun step(): List<PriceTick> {
        seq++
        return List(symbols.size) { i ->
            val bps = rng.nextInt(2 * MAX_STEP_BPS + 1) - MAX_STEP_BPS
            val price = prices[i]
            val next = max(1L, price + price * bps / 10_000)
            prices[i] = next
            PriceTick(symbols[i], Money(next), bps, seq)
        }
    }

    companion object {
        private val BASE_PRICES = mapOf(
            "BTC" to 6_500_000L,
            "ETH" to 350_000L,
            "SOL" to 15_000L,
            "XAU" to 240_000L,
            "XAG" to 3_000L,
        )
        private const val DEFAULT_BASE_PRICE = 10_000L
        private const val MAX_STEP_BPS = 50

        /** NFR-ARCH-04: state leaves the core as a Flow; the bridge collects it. */
        fun ticks(symbols: List<String>, intervalMs: Long, seed: Int): Flow<List<PriceTick>> = flow {
            val feed = PriceFeed(symbols, seed)
            while (true) {
                delay(intervalMs)
                emit(feed.step())
            }
        }
    }
}
