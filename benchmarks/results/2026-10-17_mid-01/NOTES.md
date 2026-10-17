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

- **BM-01-lock is what users see first, and kmpCore gets there ~120 ms sooner.** Explained by
  one trace per build, below.
- **BM-01 vs the last session (2026-10-05_mid-02: 527.5 / 511 ms):** both builds now take ~100 ms
  longer to draw Home. Not comparable as a regression: that session used release builds with
  no lock screen; this one uses perf builds with `skipLock`, plus slice 5's code (AuthGate and
  the auth libraries) on the startup path. The gap between the builds stays small (−17 then,
  −21 ms now).

## Limitations: checklist deviations (benchmarking.md §4.2)

| Checklist item | This session |
|---|---|
| Airplane mode on, Wi-Fi/Bluetooth off | **Airplane mode off** (mobile data on), Wi-Fi off, **Bluetooth on** |
| Battery > 50% | **48%**, charging the whole session |
| Device restarted at the start of the session | **No** (up ~9 days) |
| Freshly installed builds | BM-01 yes; BM-01-lock no, by design (it installs over onboarded apps) |

Results stay comparable **within** the session: both builds ran alternately, round by round, under
the same conditions, and every CV is ≤ 6%. Absolute numbers may carry more background noise than
a by-the-book session (background network and Bluetooth activity is what the checklist exists to
rule out), so compare them across sessions with care. Next session: restart, airplane mode on,
Bluetooth off, battery above 50%.

## Why kmpCore reaches the lock screen sooner (one trace per build)

`traces/bm-01-lock-{jsCore,kmpCore}.atrace.txt.gz`: one cold start each, `adb shell atrace -t 7
-a <pkg> sched am wm view gfx dalvik bionic binder_driver aidl res ss disk`, perf builds without
launch arguments (the same lock screen as release, but profileable), taken after this session's
runs. This phone runs `traced` without `traced_probes`, so Perfetto records nothing; atrace's text
output is parsed by `benchmarks/scripts/trace/` (`threads.py`, `binder.py`). n = 1 per build, so
the split below is indicative; the traced lock screens drew at 710 vs 581 ms (atrace adds load).

| bindApplication → lock screen fully drawn | jsCore | kmpCore | Δ |
|---|---:|---:|---:|
| Window | 582 ms | 463 ms | **+119 ms** |
| Blocking calls to `keystore2` (pid 1104 that boot) | 52 calls, 169.3 ms | 30 calls, 91.6 ms | **+22 calls, +78 ms** |
| App library loads (`dlopen`) | 31.0 ms | 23.2 ms | +8 ms (`libQuickCrypto.so` 8.4, `libSensitiveInfo.so` 1.9, op-sqlite 2.4 vs `libPocketlyCoreKmp.so` 6.4) |
| JS thread on CPU | 134.4 ms | 121.8 ms | +13 ms (jsCore's JS bundle is 0.7 MB larger) |
| All app threads on CPU | 450 ms | 431 ms | +19 ms |

- **Most of the gap is waiting, not computing.** CPU time differs by 19 ms; the window by 119 ms.
  The wait is the Keystore: both cores read the same auth state from secure storage before the
  lock screen (`getAuthState`), on a background thread (`DefaultDispatch`), but jsCore needs 22
  more round trips to `keystore2`.
- **Why more round trips:** on every read, react-native-sensitive-info 6.1.5 also verifies an
  HMAC-SHA256 tag over the entry's metadata with a second, Keystore-bound key
  (`MetadataIntegrity.kt`), on top of the AES-GCM decrypt. kmpCore's `AndroidSecureStore` does
  only the AES-GCM decrypt (key name as AAD, ADR-0010 §3). So this is a library design choice
  (extra tamper detection) with a startup cost, not the architecture. kmpCore is not faster by
  skipping security: AES-GCM already rejects a changed value and the key-name AAD stops values
  moving between keys; the HMAC protects per-entry metadata that kmpCore doesn't keep (ADR-0010 §4).
- Accounted for: ~78 + 8 + 13 ≈ 99 ms of the 119 ms; the rest is within one trace's noise.
- Not changed: the shipped design stays as ADR-0010 decides. Fewer startup reads (e.g. one record
  instead of several keys) would shrink this in both cores; noted for a later slice, not done.

## BM-08 (arm64-v8a)

| | jsCore | kmpCore | Δ |
|---|---:|---:|---:|
| APK file | 34,556 KB | 24,081 KB | −10,475 KB (−30.3%) |
| Download (bundletool, max) | 12,827 KB | 8,838 KB | **−3,989 KB (−31.1%)** |
| 2026-10-05_mid-02 download, for reference | 8,914 KB | 8,491 KB | −423 KB (−4.7%) |

APK split (`summary.md`, kmpCore − jsCore):

| Effect | Δ |
|---|---:|
| Storage choice (op-sqlite, jsCore only) | −1,564 KB |
| PIN crypto choice (libQuickCrypto.so, jsCore only) | **−9,132 KB**, of which OpenSSL ≈ 7,565 KB (83% of its sized symbols); gzipped ≈ 3,367 KB |
| Secure-storage library (libSensitiveInfo.so, jsCore only; kmpCore's store is a few Kotlin classes) | −723 KB |
| KMP architecture (Nitro bridge library, Kotlin dex, smaller JS bundle) | **+943 KB** |

(The split was refined after this session's first write-up: sensitive-info used to sit inside
the architecture row, which then read +220 KB. Same data, recomputed by `collect.ts`.)

- **The bridge grows with the contract.** kmpCore's Nitro bridge library `libPocketlyCoreKmp.so`
  went from 749 KB (2026-10-03) to 864 KB (2026-10-05_mid-02, slice 4) to **1,540 KB** now:
  **+676 KB (+78%) since slice 4**, while the Nitro spec went from 19 to 35 methods (auth, phone,
  biometrics, logout, BM-10) plus their structs. That is roughly ~42 KB of generated C++/JNI per
  method on arm64 (rough: methods and their structs are mixed), and it is most of the architecture row: without it the row would be −597 KB (the
  smaller JS bundle outweighs the Kotlin dex). jsCore has no equivalent cost: its contract
  methods are plain JS. Gzipped the bridge library is smaller, but it scales with the API. **Design
  guidance (ADR-0002, "Keep the contract coarse"):** a few methods that do a lot each beat many
  small ones, for app size (this finding) and for call overhead (BM-06).
- Since slice 4, jsCore's download grew ~3.9 MB, almost all quick-crypto; kmpCore's grew ~0.35 MB
  (mostly the bridge). Both include BM-10's what-if libraries (@noble/hashes in the JS bundle,
  KotlinCrypto in the dex), which are small. **Fixed after this session (2026-10-17):** benchmark-only code
  (these libraries, the harness and 8 Nitro methods of the bridge library) is now in perf builds
  only (ADR-0003, "Benchmark-only code"), so the next BM-08 run measures release builds without
  it; this session's sizes still include it, in both builds. As ADR-0010 §8 says, the size gap is mostly library
  choices, not the architecture.
