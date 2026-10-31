# Session 2026-11-01_mid-02

**BM-08 only**, a clean before/after for two size fixes (`5ec203a`): kmpCore's bridge library built with hidden
symbols, and one ML Kit keep rule instead of four whole packages. Host-only, as `2026-11-01_mid-01` (the "before",
built from `5d1520b`; `82b90fd` between them changed only app JS and tests). `apk-size.ts` on the release split
APKs, `bm-08-download-size.sh` (bundletool 1.18.3), `collect.ts` for `summary.md` / `summary.csv`. No device
involved; the scanner and the bridge were checked on the vivo before the commit (see `5ec203a`).

## Code
- Release APKs (`-PsplitApksByAbi`) and bundles built from `5ec203a`. `check-release-clean.sh release` passes (14/14).
- `packages/core-kmp/android/CMakeLists.txt`: `-fvisibility=hidden -fvisibility-inlines-hidden`. The library was
  already stripped (no `.debug_*`, no `.symtab`) and built with `-ffunction-sections -fdata-sections` and
  `--gc-sections`, at `-O2 -g` (AGP's RelWithDebInfo). What it shipped on top was every generated C++ symbol
  exported: 3,642 dynamic symbols, 521 KB of names in `.dynstr`. Now `JNI_OnLoad` and the std/jsi type info their
  headers mark visible (61). `-Os` was measured: on its own it made the library 92 KB bigger.
- `apps/mobile/android/app/proguard-rules.pro`: `-keep class * implements ComponentRegistrar { void <init>(); }`
  replaces keeping `com.google.mlkit.**` and three `mlkit_*` packages whole (ML Kit's registrars lost their
  constructors under R8 full mode; firebase-components 16.1.0's own rule has no member spec).

## Results (arm64-v8a)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---:|
| APK file | 35,317 KB | 24,689 KB | −10,629 KB (−30.1%) |
| Download (bundletool, max) | 13,144 KB | 9,206 KB | **−3,938 KB (−30.0%)** |

Split (kmpCore − jsCore, APK): storage choice −1,564 KB; PIN crypto choice −9,132 KB; secure-storage library
−723 KB; **KMP architecture +789 KB** (was +1,509 KB in mid-01).

## Before/after (vs 2026-11-01_mid-01)

| | jsCore | kmpCore |
|---|---:|---:|
| APK file | −126 KB | **−846 KB** |
| Bridge library `libPocketlyCoreKmp.so` | — | **2,123 → 1,395 KB (−728 KB)** |
| Dex | −128 KB (945 fewer kept classes) | −131 KB (942 fewer) |
| JS bundle | +2 KB (`82b90fd`'s first-screen signal) | +2 KB |
| Download (bundletool, max) | **−131 KB** | **−231 KB** |

- **The ML Kit rule is a real-user saving in both builds** (~130 KB of dex, ~130 KB of download): it doesn't move
  the comparison.
- **Hidden symbols take a third off the bridge library.** Native libraries are stored uncompressed in the APK, so
  the APK saving (−728 KB) is much larger than the download saving (~−100 KB: symbol names compress well).
- **The architecture's cost drops from +1,509 to +789 KB of APK.** The download gap between the builds widens to
  −3,938 KB.

## Bridge cost per bridged item, re-estimated (`bridge-by-spec.txt`)
The bridge library rebuilt with hidden symbols at each spec version (the Nitro-generated code and the adapter of
that commit, built with today's CMake), arm64, stripped as AGP strips it (`llvm-strip --strip-unneeded`):

| Spec (commit) | Library | Step | Items | Per item (was, default visibility) |
|---|---:|---:|---:|---:|
| before slice 6 (`82f1082`) | 868 KB | | | |
| slice 6, transfers (`0339e93`) | 1,099 KB | +231 KB | 19 (7 methods, 12 types) | **~12 KB** (~18) |
| top-up (`a217ddc`) | 1,147 KB | +48 KB | 4 (2 + 2) | **~12 KB** (~18) |
| QR Pay, My QR (`c3010fc`) | 1,290 KB | +143 KB | 9 (4 + 5) | **~16 KB** (~23) |
| notifications (`568f95e`) | 1,395 KB | +105 KB | 8 (3 + 3, a subscription object, a callback) | **~13 KB** (~21) |

**~13 KB of APK per bridged method or type on arm64 (12–16), ~3 KB of download**, down from ~18–23 KB: the
exported names were about a third of each item's cost. Big structs still cost more (QR's step).

## Host
- 11 GB free on the Mac before and after.
