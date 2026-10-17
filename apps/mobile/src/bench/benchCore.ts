// Virtual module: Metro resolves it to @pocketly/core-js-bench or @pocketly/core-kmp-bench, and
// only in perf bundles (metro.config.js). This file is reachable only through
// @pocketly/bench-app, so release bundles never contain it.
import { createBench } from '@pocketly/bench-impl';
import { core } from '../core';

/** Benchmark-only entry points of the running core (BenchCore, core-contract/bench.ts). */
export const bench = createBench(core);
