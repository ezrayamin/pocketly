import { NitroModules } from 'react-native-nitro-modules';
import { toCoreError } from '@pocketly/core-contract';
import type { BenchCore, Core, IngestResult } from '@pocketly/core-contract';
import type { PocketlyBench } from './specs/PocketlyBench.nitro';

export type { PocketlyBench } from './specs/PocketlyBench.nitro';

function rethrow(e: unknown): never {
  throw toCoreError(e);
}

/**
 * BenchCore for kmpCore (perf bundles only: `@pocketly/bench-impl`, metro.config.js). The Nitro
 * object works on the process's one `PocketlyCore`, so `_core` is not needed here.
 */
export function createBench(_core: Core): BenchCore {
  const native = NitroModules.createHybridObject<PocketlyBench>('PocketlyBench');
  return {
    // Straight through: it can't throw, and BM-06 times exactly this path.
    echo: (value: number) => native.echo(value),
    formatMoneyBatch(minors: number[]): string[] {
      try {
        return native.formatMoneyBatch(minors);
      } catch (e) {
        throw toCoreError(e);
      }
    },
    ingestTransactions: (json: string): Promise<IngestResult> => native.ingestTransactions(json).catch(rethrow),
    stageIngestPayload: (json: string) => native.stageIngestPayload(json).catch(rethrow),
    ingestStaged: (): Promise<IngestResult> => native.ingestStaged().catch(rethrow),
    lastComputeMs: () => native.lastComputeMs(),
    lastStorageMs: () => native.lastStorageMs(),
    pbkdf2WhatIf: (password: string, saltHex: string, iterations: number) =>
      native.pbkdf2WhatIf(password, saltHex, iterations).catch(rethrow),
  };
}
