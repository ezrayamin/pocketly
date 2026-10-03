# ADR-0001: One contract, two cores, selected at build time

**Status:** Accepted · 2026-10-03

## Context

The benchmark ([benchmarking.md](../benchmarking.md) §1) compares bare RN with RN + KMP. The only variable can be
*where the business logic runs*. Screens, navigation, dependencies and fake-backend behavior
have to be identical.

## Decision

- `packages/core-contract` defines a single `Core` interface and every bridged type. It's the
  only thing the UI imports.
- `core-js` and `core-kmp` implement it. The app imports a virtual module, `@pocketly/core-impl`,
  which Metro resolves to exactly one of them (`apps/mobile/metro.config.js`).
- Android selects through product flavors (`jsCore`, `kmpCore`), so both apps install side by
  side. iOS selects at `pod install` time (`CORE_IMPL=kmp`).

The plan's example used `process.env.CORE_IMPL ? require(a) : require(b)`. We chose a Metro
alias instead because the unused core never enters the module graph at all, so there's nothing
for dead-code elimination to miss.

## Consequences

- To run a debug build you need a Metro server for the matching core (`yarn start` /
  `yarn start:kmp`). Release builds pick the right config automatically.
- Every `Core` method has to be implemented twice. The contract suite plus shared fixtures
  (ADR-0004) keep the two implementations honest.
