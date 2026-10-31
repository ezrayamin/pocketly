# Session 2026-11-01_mid-01

**BM-08 only**, after slice 7's notifications (F9, ADR-0017): what three more Nitro methods, a second
subscription object and an in-app notification UI cost. Host-only, as `2026-10-30_mid-02`: `apk-size.ts` on the
release split APKs and `bm-08-download-size.sh` (bundletool 1.18.3). No device involved. `summary.md` /
`summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code
- Release APKs (`-PsplitApksByAbi`) and bundles built from `5d1520b`. `check-release-clean.sh release` passes on
  them (14/14).
- Compared with `2026-10-30_mid-02` (`ec2d2b9`, QR), the release difference is notifications:
  - the event log and EventSync in both cores (the fake server's log, signals and settlement timers; the
    replica's notifications table and cursor; PaymentFlow.applySettled);
  - in kmpCore, the Nitro spec going from 41 to **44 methods** (subscribeNotifications, getNotifications,
    markNotificationsRead), **3 new bridged types** (AppNotification, NotificationKind, NotificationList), a
    second subscription HybridObject (NotificationSubscription) and its callback type;
  - in both builds, the same UI: the banner, the bell's badge, the Notifications screen. No new dependencies.

## Results (arm64-v8a)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---:|
| APK file | 35,444 KB | 25,535 KB | −9,909 KB (−28.0%) |
| Download (bundletool, max) | 13,275 KB | 9,437 KB | **−3,838 KB (−28.9%)** |

Split (kmpCore − jsCore, APK): storage choice −1,564 KB; PIN crypto choice −9,132 KB; secure-storage library
−723 KB; **KMP architecture +1,509 KB** (was +1,354 KB in mid-02).

## What notifications added (vs 2026-10-30_mid-02)

| | jsCore | kmpCore |
|---|---:|---:|
| APK file | +30 KB | **+186 KB** |
| Dex | 0 | +16 KB (42 more kept classes: 27 in the KMP core, 15 in the Nitro adapter) |
| JS bundle (uncompressed) | +30 KB (core-js event sync + UI) | +10 KB (UI) |
| Bridge library `libPocketlyCoreKmp.so` | — | **1,953 → 2,123 KB (+170 KB)** |
| Download (bundletool, max) | +13 KB | **+48 KB** |

- **The bridge grew +170 KB for 3 methods, 3 types, a second subscription object and its callback: ~21 KB per
  item** counting all eight (~28 KB per method-or-type counting only the six), in line with QR's ~23 KB.
  ADR-0017 §3 estimated ~110 KB from 3 methods and 3 types; the subscription object and the callback, which a
  stream needs and a request/response method doesn't, are the difference. Reusing `PriceSubscription` (renamed
  to a generic `Subscription`) would have saved one of them.
- **The feature itself is small in both builds:** jsCore's whole cost is 30 KB of JavaScript; kmpCore's Kotlin
  (EventSync, the event log, the adapter) is 16 KB of dex. Everything else on the kmpCore side is the bridge.
- **The architecture's cost keeps following the bridged surface:** +1,354 → +1,509 KB APK (+155 KB). kmpCore paid
  +35 KB more download than jsCore for the same feature (+48 vs +13 KB).
- kmpCore remains ~29% smaller to download overall, all of it from the storage and crypto choices.

## Host
- 8.1 GB free on the Mac before, 6.5 GB after (build outputs). Getting low: worth clearing old Gradle and Xcode build caches before the next device session.
