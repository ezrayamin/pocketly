# ADR-0004: Keeping the two cores at parity

**Status:** Accepted · 2026-10-03 · Implements BM-PAR-01…05

## Decisions

1. **Shared fixtures, two test runners (BM-PAR-01).** The parity fixtures live in
   `packages/core-contract/fixtures`. `money.json`, `state-machine.json` and `ingest.json` are
   written by hand. `golden.json` is generated from `core-js` and checked in. Jest runs them
   against `core-js`, and JUnit (`shared/src/jvmTest/.../ContractFixturesTest.kt`) runs the same
   files against the KMP facade. Neither core is trusted on its own: a divergence fails a suite.

2. **Same algorithms (BM-PAR-02).** Every Kotlin file names the TS file it mirrors. Both cores
   use the same single-pass summary, the same hash maps, the same sorts, the same binary-search
   pagination and the same "parse to a generic JSON tree, then validate field by field" ingest.
   Calendar math uses the same Hinnant algorithms in both, not `Date` or `kotlinx-datetime`.

3. **Deterministic data (BM-PAR-04).** Both cores carry a Mulberry32 PRNG and a seed generator
   that consumes exactly 8 random draws per entry, so the same `(seed, count, now)` gives
   identical datasets. `DEFAULT_DATASET` is fixed at 2026-10-01T12:00Z.

4. **Money across the bridge.** In Kotlin, money is `Money(Long)` (NFR-MONEY-01). JS has no
   `Long`, so amounts cross as `number` and must be safe integers. `BridgeConversions` is the
   one place a `Double` becomes money, and it rejects anything that isn't exact. `MAX_AMOUNT_MINOR`
   (99,999,999,999.99) stays well inside 2^53.

5. **Timestamps as epoch millis.** requirements §3.1 uses `Instant`. We use `Long` epoch millis
   so both cores compare plain numbers in the hot loops. `kotlin.time.Instant` is still
   experimental in Kotlin 2.2.

6. **`Transaction.category` added.** BM-03 groups spending by category, which §3.1 doesn't
   model. Merchants carry a category; transfers and top-ups use `TRANSFER` / `TOP_UP`.

7. **Storage (BM-PAR-03): in-memory for now.** Both cores use an in-memory `TransactionStore`
   behind the same interface. When SQLite arrives (SQLDelight in Kotlin, a JS SQLite binding for
   `core-js`), the engines will differ, so BM-04 will report "parse + validate" and "write to
   DB" as separate numbers, as the plan requires.

## Consequences

- Changing an algorithm means changing both cores and regenerating `golden.json` in the same commit.
- `lastComputeMs()` gives the compute-only time from inside each core ([benchmarking.md](../benchmarking.md) §5.2).
  For `kmpCore` it's measured in Kotlin, so end-to-end minus compute = bridge overhead.
