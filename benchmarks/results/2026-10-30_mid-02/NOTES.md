# Session 2026-10-30_mid-02

**BM-08 only**, after slice 7's QR Pay and My QR (ADR-0016): what four more Nitro methods and a barcode
scanner cost. Host-only, as `mid-01`: `apk-size.ts` on the release split APKs and `bm-08-download-size.sh`
(bundletool 1.18.3). No device involved. `summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code
- Release APKs (`-PsplitApksByAbi`) and bundles built from `ec2d2b9`. `check-release-clean.sh release` passes on
  them (14/14).
- Compared with `2026-10-30_mid-01` (`96aaad8`, top-up), the release difference is QR Pay and My QR:
  - the QR contract in both cores (parser, payment requests, PaymentFlow's third kind);
  - in kmpCore, the Nitro spec going from 37 to **41 methods** with **5 new bridged types** (QrCode, QrKind,
    QrRejectReason, QrPaymentDraft, QrPaymentReview) and two ErrorCode values;
  - in both builds, the same UI and three new dependencies: `react-native-data-scanner` 0.1.2 (Nitro, with
    Google's `play-services-code-scanner` 16.1.0), `qrcode-generator` 2.0.4 (pure JS), and the in-repo
    brightness module;
  - in both builds, R8 keep rules for ML Kit, which the scanner needs in release builds (`ec2d2b9`).

## Results (arm64-v8a)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---:|
| APK file | 35,414 KB | 25,349 KB | −10,064 KB (−28.4%) |
| Download (bundletool, max) | 13,262 KB | 9,389 KB | **−3,872 KB (−29.2%)** |

Split (kmpCore − jsCore, APK): storage choice −1,564 KB; PIN crypto choice −9,132 KB; secure-storage library
−723 KB; **KMP architecture +1,354 KB** (was +1,136 KB in mid-01).

## What QR Pay and My QR added (vs 2026-10-30_mid-01)

| | jsCore | kmpCore |
|---|---:|---:|
| APK file | +776 KB | **+994 KB** |
| Scanner native library `libNitroDataScanner.so` | +236 KB | +236 KB |
| Dex | +284 KB | +301 KB |
| Resources | +158 KB | +158 KB |
| JS bundle (uncompressed) | +83 KB (core-js QR code + UI + qrcode-generator) | +61 KB (UI + qrcode-generator) |
| Bridge library `libPocketlyCoreKmp.so` | — | **1,742 → 1,953 KB (+211 KB)** |
| Download (bundletool, max) | +408 KB | **+460 KB** |

- **The scanner costs both builds about the same: ~680 KB of APK, ~400 KB of download.** Its Nitro library
  (+236 KB), ML Kit's classes (R8 now keeps 1,721 more classes in each build: 1,350 of them ML Kit,
  171 under `com.google.mlkit` and 1,179 in its internal `mlkit_*` packages, kept whole by the keep rules;
  the rest Play services, Firebase components and the scanner's own 24), and its resources (+158 KB). Google's
  scanning UI and model come with Play services, not the APK, so this is the client side only. It doesn't
  change the architecture comparison.
- **The bridge grew +211 KB for 4 methods and 5 types (plus 2 enum values): ~23 KB each**, a little above the
  ~18 KB of slices 6 and 7's top-up. QrPaymentDraft is the largest struct bridged so far (8 fields, a nested
  Counterparty). ADR-0016 §5 estimated ~160 KB.
- **The architecture's cost keeps following the bridged surface:** +1,136 → +1,354 KB APK (+218 KB). kmpCore
  paid +52 KB more download than jsCore for the same feature (+460 vs +408 KB); without the scanner that
  difference is the whole feature, as in slices 6 and 7.
- kmpCore remains ~29% smaller to download overall, all of it from the storage and crypto choices.

## Follow-ups
- The ML Kit keep rules keep everything under `com.google.mlkit` and three `mlkit_*` internal packages. Narrower
  rules (only the reflectively created registrars and components) would shrink the dex part; they need the
  scanner rechecked on a device after each change.

## Host
- 11 GB free on the Mac before and after.
