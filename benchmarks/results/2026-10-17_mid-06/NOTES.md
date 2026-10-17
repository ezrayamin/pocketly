# Session 2026-10-17_mid-06

**BM-08 only**, after slice 6 (P2P transfers, ADR-0014): what seven more Nitro methods cost.
Host-only: `apk-size.ts` on the release split APKs and `bm-08-download-size.sh` (bundletool
1.18.3). No device involved, so the §4.2 device checklist doesn't apply. `summary.md` /
`summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code
- Release APKs (`-PsplitApksByAbi`) and bundles built from `d776d30` (app code as of
  `fa3b222`; later commits touched only scripts, docs and results). `check-release-clean.sh
  release` passes on them (14/14).
- Compared with `2026-10-17_mid-02` (`82f1082`, slice 5 without benchmark code), the release
  difference is slice 6: the transfer contract in both cores, the Send flow UI, and in kmpCore
  the Nitro spec going from 28 to **35 methods** with **12 new bridged types** (Contact,
  ContactSearch, PhoneLookup, TransferDraft, AmountCheck, AmountRejectReason, TransferReview,
  TransferAuth, TransferAuthMethod, TransferAuthOutcome, TransferResult, TransferState) and one
  more NetworkSimulation field.
- Built twice: the first attempt stopped with "No space left on device" on the host (not the
  code); after freeing space (the worktree's iOS build outputs), a stale Gradle lock needed
  `--stop`. The measured build is the third, complete one.

## Results (arm64-v8a)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---:|
| APK file | 34,604 KB | 24,271 KB | −10,333 KB (−29.9%) |
| Download (bundletool, max) | 12,844 KB | 8,894 KB | **−3,950 KB (−30.8%)** |

Split (kmpCore − jsCore, APK): storage choice (op-sqlite) −1,564 KB; PIN crypto choice
(libQuickCrypto.so) −9,132 KB; secure-storage library −723 KB; **KMP architecture +1,085 KB**
(was +752 KB in mid-02).

## What slice 6 added (vs 2026-10-17_mid-02)

| | jsCore | kmpCore |
|---|---:|---:|
| APK file | +102 KB | **+434 KB** |
| JS bundle (uncompressed) | +102 KB (core-js transfer code + Send UI) | +50 KB (Send UI only) |
| Kotlin dex | ±0 | +31 KB (TransferFlow, TransferPolicy, ContactSearch; adapter 117 → 147 kept classes, shared core 183 → 243) |
| Bridge library `libPocketlyCoreKmp.so` | — | **1,318 → 1,668 KB (+351 KB)** |
| Download (bundletool, max) | +39 KB | **+120 KB** |

- **The bridge grew ~50 KB per method this time** (+351 KB for 7 methods), above the ~30–40 KB
  that ADR-0002 took from the slice-5 cleanup. The difference is the types: these 7 methods
  brought 12 new structs and enums (each with C++, JNI and Kotlin/Swift glue), where the 8 removed
  bench methods shared a few. Per bridged *method or type* it's ~18 KB. The guidance stands and
  gets sharper: a coarse contract means few methods **and** few, reused structs.
- **The architecture's cost is no longer flat.** It was +822 → +835 → +918 KB APK across slices
  1–4, +752 KB after the bench code left (mid-02), and is now +1,085 KB: it grows with the
  bridged surface, ~+330 KB for this slice (+351 KB bridge, +31 KB dex, partly offset by kmpCore's
  smaller JS bundle growth). On download that is about +80 KB.
- **jsCore paid for the same feature in its JS bundle** (+102 KB uncompressed, +39 KB download);
  kmpCore paid +120 KB download, three times as much, mostly in the bridge.
- kmpCore remains ~31% smaller to download overall, all of it from the storage and crypto choices
  (ADR-0009, ADR-0010), as in mid-02.
