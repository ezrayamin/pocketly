package com.pocketly.shared.data.fake

/**
 * Mulberry32. Integer-only, so it produces exactly the same sequence as
 * packages/core-js/src/data/random.ts (BM-PAR-04).
 */
internal class SeededRandom(seed: Int) {
    private var state: Int = seed

    fun nextUInt32(): Long {
        state += 0x6D2B79F5
        var t = state
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + (t xor (t ushr 7)) * (t or 61))
        return (t xor (t ushr 14)).toLong() and 0xFFFF_FFFFL
    }

    /** In [0, bound). */
    fun nextInt(bound: Int): Int = (nextUInt32() % bound).toInt()
}
