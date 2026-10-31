# Session 2026-10-30_mid-01

**BM-08 only**, after slice 7 (Top-Up, ADR-0015): what two more Nitro methods cost. Host-only:
`apk-size.ts` on the release split APKs and `bm-08-download-size.sh` (bundletool 1.18.3). No device
involved, so the §4.2 device checklist doesn't apply (the vivo was prepared anyway and left out).
`summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code
- Release APKs (`-PsplitApksByAbi`) and bundles built from `96aaad8` (slice 7 steps 1–4).
  `check-release-clean.sh release` passes on them (14/14).
- Compared with `2026-10-17_mid-06` (`d776d30`, slice 6), the release difference is slice 7:
  the top-up contract in both cores, the Top-Up flow UI, and in kmpCore the Nitro spec going from
  35 to **37 methods** (checkTopUpAmount, reviewTopUp) with **2 new bridged types** (TopUpMethod,
  TopUpReview), two more NetworkSimulation fields, and one more value in each of ErrorCode and
  AmountRejectReason. ADR-0015 §1 kept it at two methods by reusing confirmTransfer and
  getTransferStatus.

## Results (arm64-v8a)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---:|
| APK file | 34,637 KB | 24,355 KB | −10,282 KB (−29.7%) |
| Download (bundletool, max) | 12,854 KB | 8,929 KB | **−3,924 KB (−30.5%)** |

Split (kmpCore − jsCore, APK): storage choice (op-sqlite) −1,564 KB; PIN crypto choice
(libQuickCrypto.so) −9,132 KB; secure-storage library −723 KB; **KMP architecture +1,136 KB**
(was +1,085 KB in mid-06).

## What slice 7 added (vs 2026-10-17_mid-06)

| | jsCore | kmpCore |
|---|---:|---:|
| APK file | +33 KB | **+84 KB** |
| JS bundle (uncompressed) | +33 KB (core-js top-up code + Top-Up UI) | +20 KB (Top-Up UI only) |
| Kotlin dex | ±0 | +7 KB (TopUpPolicy, top-up attempts; adapter 147 → 152 kept classes, shared core 243 → 260) |
| Bridge library `libPocketlyCoreKmp.so` | — | **1,668 → 1,742 KB (+74 KB)** |
| Download (bundletool, max) | +10 KB | **+35 KB** |

- **~18 KB per bridged method or type again.** +74 KB for 2 methods and 2 types (plus the new
  struct fields and enum values) matches mid-06's ~18 KB per method or type. ADR-0015's choice of
  2 methods instead of 4 (no separate confirmTopUp / getTopUpStatus, which would also have needed
  their own result struct) saved roughly 50 KB of bridge.
- **The architecture's cost keeps growing with the bridged surface:** +1,085 → +1,136 KB APK
  (+51 KB), about +25 KB of download.
- **jsCore paid for the same feature in its JS bundle** (+33 KB uncompressed, +10 KB download);
  kmpCore paid +35 KB download, 3.5 times as much, mostly in the bridge. Slice 6 showed the same
  pattern (+39 vs +120 KB).
- kmpCore remains ~30% smaller to download overall, all of it from the storage and crypto choices
  (ADR-0009, ADR-0010), as in mid-02 and mid-06.

## Host
- 11 GB free on the Mac after the build (it was 13 GB before). The slice 6 session ran out of space
  once; a bigger build would need room made first.
