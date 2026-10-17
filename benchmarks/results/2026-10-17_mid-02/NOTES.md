# Session 2026-10-17_mid-02

**BM-08 only**, rerun after benchmark-only code left release builds (commit `82f1082`, ADR-0003
"Benchmark-only code"). Host-only: `apk-size.ts` on the release split APKs and
`bm-08-download-size.sh` (bundletool). No device involved, so the §4.2 device checklist doesn't
apply. `summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code
- Release APKs and bundles built from `82f1082` (the APKs just before the commit, from the same
  code: only docs changed after that build). `check-release-clean.sh release` passes on them.
- Compared with `2026-10-17_mid-01`, the only code difference in release is the removal of
  benchmark-only code.

## Results (arm64-v8a)

| | jsCore | kmpCore | Δ |
|---|---:|---:|---:|
| APK file | 34,503 KB | 23,837 KB | −10,666 KB (−30.9%) |
| Download (bundletool, max) | 12,805 KB | 8,775 KB | **−4,030 KB (−31.5%)** |

Split (kmpCore − jsCore): storage choice (op-sqlite) −1,564 KB; PIN crypto choice
(libQuickCrypto.so) −9,132 KB, of which OpenSSL ≈ 7,565 KB; secure-storage library
(libSensitiveInfo.so) −723 KB; **KMP architecture +752 KB** (was +943 KB with the bench code).

## What removing benchmark-only code changed (vs 2026-10-17_mid-01)

| | jsCore | kmpCore |
|---|---:|---:|
| APK file | −53 KB | **−244 KB** |
| JS bundle | −53 KB (core-js-bench, @noble/hashes, the harness) | −20 KB (the harness) |
| Kotlin dex | ±0 | −12 KB (KotlinCrypto, the bench facade, CoreProbe's ingest path) |
| Bridge library `libPocketlyCoreKmp.so` | — | **1,540 → 1,318 KB (−222 KB)** |
| Download (bundletool, max) | −22 KB | −63 KB |

- **The bridge lost 222 KB for 8 methods** (echo, formatMoneyBatch, the three ingest entry
  points, the two timing getters, pbkdf2WhatIf) plus the IngestResult/IngestError structs and
  enum: ~28 KB per method. That is below the ~42 KB/method estimate from slice 4 → 5 (ADR-0002),
  which mixed in larger structs; the rough figure is ~30–40 KB per method, and the guidance
  stands: keep the contract coarse.
- The benchmark code moved, it wasn't lost: the same checks run inverted on perf builds
  (`check-release-clean.sh perf`) find every marker there, and the harness ran BM-03, BM-04b,
  BM-06 and BM-10 on both perf builds (same outputs in both; BM-06's echo cost unchanged).
- Classes kept by R8 for the Nitro adapter: 126 → 117 (kmpCore release).
