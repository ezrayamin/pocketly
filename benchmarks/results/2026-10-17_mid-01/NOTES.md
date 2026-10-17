# Session 2026-10-17_mid-01

Slice 5's startup and size reruns: **BM-01-lock** (new: cold start → lock screen, release builds),
**BM-01** (cold start → Home, perf builds with `pocketly.skipLock`) and **BM-08** (APK breakdown
with OpenSSL on its own line, bundletool download size). Raw files are never edited;
`summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code and device
- APKs and bundles built from the commit with these results (on top of `d2ee49e`), which adds
  the lock screen's `<FullyDrawnMarker />` and `TARGET=lock` in `bm-01-startup.sh`. The BM-01-lock
  method was written into benchmarking.md before this session.
- vivo V2538, OS `16.0.21.0` (`PD2529DF_EX_A_16.0.21.0.W20`), on the charger, battery 48% (earlier
  sessions: 100%), airplane mode off. Battery at launch: 33.8–35.4 °C (BM-01-lock), 35.9–37.1 °C
  (BM-01).
- Order: BM-01-lock first (it needs onboarded installs: the release APKs went over the onboarded
  perf apps, PIN set, biometrics off), then BM-01 (fresh perf installs), then BM-08 on the Mac.
  Both builds were onboarded again afterwards.

## Results (medians, n = 20 per build, 2 warm-up rounds dropped, builds alternating)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---|
| **BM-01-lock**, time to first frame | 312 ms | 306 ms | −4 ms, not meaningful |
| **BM-01-lock**, lock screen fully drawn | 662 ms | 543.5 ms | **−118 ms (−17.9%)**, 95% CI −137 to −98 ms, IQRs apart |
| **BM-01**, time to first frame | 300 ms | 300 ms | −3.5 ms, not meaningful |
| **BM-01**, Home fully drawn | 626.5 ms | 604 ms | −21 ms (−3.6%), IQRs overlap: not meaningful |

All CVs ≤ 6.0%; no relaunches, no excluded runs.

- **BM-01-lock is what users see first, and kmpCore gets there ~120 ms sooner.** Before the lock
  screen can show, each core reads its auth state from secure storage. Not explained yet;
  candidates to check (not tested here): jsCore's extra native libraries loading at startup
  (`libQuickCrypto.so`, 9.1 MB with OpenSSL; `libSensitiveInfo.so`), and sensitive-info's
  Keystore + SharedPreferences read vs kmpCore's own store. A trace of the cold start would tell.
- **BM-01 vs the last session (2026-10-05_mid-02: 527.5 / 511 ms):** both builds now take ~100 ms
  longer to draw Home. Not comparable as a regression: that session used release builds with
  no lock screen; this one uses perf builds with `skipLock`, plus slice 5's code (AuthGate and
  the auth libraries) on the startup path. The gap between the builds stays small (−17 then,
  −21 ms now).

## BM-08 (arm64-v8a)

| | jsCore | kmpCore | Δ |
|---|---:|---:|---:|
| APK file | 34,556 KB | 24,081 KB | −10,475 KB (−30.3%) |
| Download (bundletool, max) | 12,827 KB | 8,838 KB | **−3,989 KB (−31.1%)** |
| 2026-10-05_mid-02 download, for reference | 8,914 KB | 8,491 KB | −423 KB (−4.7%) |

APK split (`summary.md`): storage choice (op-sqlite) −1,564 KB, **PIN crypto choice
(libQuickCrypto.so) −9,132 KB, of which OpenSSL ≈ 7,565 KB** (83% of the library's sized
symbols), the library gzipped ≈ 3,367 KB, and **the KMP architecture itself +220 KB**. Since
slice 4, jsCore's download grew ~3.9 MB, almost all quick-crypto; kmpCore's grew ~0.35 MB. Both
include BM-10's what-if libraries (@noble/hashes in the JS bundle, KotlinCrypto in the dex),
which are small. As ADR-0010 §8 says, the size gap is mostly a library choice, not the
architecture.
