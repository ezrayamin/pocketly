declare module '@pocketly/core-impl' {
  import type { Core } from '@pocketly/core-contract';

  export function createCore(): Core;
}

declare module '@pocketly/bench-impl' {
  import type { BenchCore, Core } from '@pocketly/core-contract';

  export function createBench(core: Core): BenchCore;
}
