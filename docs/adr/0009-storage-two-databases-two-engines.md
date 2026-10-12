# ADR-0009: Storage — a fake server DB, a client replica, two SQLite engines

**Status:** Accepted · 2026-10-04 · Implements FR-FAKE-07, FR-HIST-04, BM-PAR-03

## Decisions

1. **Two databases, two files.**
   - `pocketly-server.db`: the fake backend's source of truth ("on another machine",
     FR-FAKE-07). Only `FakeWalletApi` touches it.
   - `pocketly-cache.db`: the app's **full local replica** of the ledger (FR-HIST-04).
   Sharing tables would let offline mode read live server data and hide stale-cache bugs.
2. **Replica + delta sync.** Refreshing (the first History/Home page) pulls server changes
   ordered by `(updatedAt, id)` into the replica. Pagination, the monthly summary (BM-03) and
   ingest (BM-04) run on the replica. When the server can't be reached (unavailable, timeout,
   server error), reads return the replica marked `stale: { reason, cachedAt }`; with nothing
   cached, they reject. Ingest writes to the replica only, so it never changes server balances.
3. **One schema and one set of queries.** SQLDelight's `.sq` files are the single source.
   `yarn sql:generate` writes the same CREATE statements and the same labeled SQL into core-js;
   `yarn sql:check` fails if they drift. Both cores run identical SQL text.
4. **Engines differ (BM-PAR-03, chosen deliberately).**
   - kmpCore: SQLDelight on the **platform SQLite** (Android `android.database.sqlite`, iOS `libsqlite3`).
   - jsCore: **op-sqlite** (JSI) with its **bundled SQLite**. That's what a typical RN team would ship.
   Reporting rules that follow:
   - BM-03/BM-04 report **compute** (`lastComputeMs`) and **storage** (`lastStorageMs`) separately;
     only compute compares "where the core runs".
   - BM-08 lists op-sqlite's native library on its own line: it's jsCore's storage cost.
5. **Linking.** op-sqlite's Turbo Module glue stays autolinked in both flavors (codegen; see
   ADR-0003), but kmpCore excludes `OPSQLitePackage` (`CorePackages.excludedPackageClasses`,
   kept by name in R8) and strips `libop-sqlite.so` from its APKs. Verified: kmpCore starts
   without it; without the package exclusion it crashed (legacy packages are created eagerly).

## Consequences

- Each core opens its databases lazily on first use; the app seeds the server only when empty,
  so data survives restarts. `simulateIncomingTransfer` numbering is persisted with it.
- Tests: Jest uses Node's built-in `node:sqlite`; JUnit uses SQLDelight's JDBC driver.
- kmpCore never ships op-sqlite: Android excludes its package and strips `libop-sqlite.so`;
  iOS doesn't link the pod when `CORE_IMPL=kmp` (`react-native.config.js`). The iOS framework
  is static, so `PocketlyCoreKmp.podspec` links the system `libsqlite3`.
- Over Nitro, `resetData` takes `(DatasetSeed, Transaction[])` instead of `DatasetConfig`: an
  optional array of structs inside a struct breaks Swift's `std::vector<Transaction>`
  conformance (Xcode 16.4 / Swift 6.1 C++ interop), which also broke `TransactionPage.items`.
  The `Core` contract is unchanged; `KmpCore.resetData` splits the config.
