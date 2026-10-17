/**
 * Benchmark-only constants. Not exported from the package index, so release bundles (which import
 * the index) don't carry them; bench code and tests import this file directly.
 */

/** BM-10 (BenchCore.pbkdf2WhatIf): upper bound on iterations, so a typo can't hang the app for minutes. */
export const BM10_MAX_ITERATIONS = 1_000_000;
