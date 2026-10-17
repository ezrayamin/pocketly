# Pocketly — Benchmarking Plan

**Status:** Draft v0.2 · **Related:** `product.md`, `requirements.md`, ADR-0009 · **Last updated:** 2026-10-04
**Primary platform:** Android (most target users). iOS results are optional and reported separately.

---

## 1. Goal

Compare the performance of two builds of the **same app**:

| Build | Business logic runs in | UI |
|---|---|---|
| **`jsCore`** (bare React Native) | TypeScript on the JS thread (Hermes) | React Native |
| **`kmpCore`** (React Native + KMP) | Kotlin compiled to native code, called through a native module | React Native |

Both builds share identical screens, navigation, dependencies and fake-backend behavior. **The only variable is where the core logic runs.**

## 2. Hypotheses

Written before any measurement, then confirmed or rejected in the report.

| ID | Hypothesis | Expected winner |
|---|---|---|
| H1 | CPU-heavy work (aggregations, large parsing) is faster in Kotlin | `kmpCore` |
| H2 | Moving logic to Kotlin lowers JS-thread CPU during streams, so JS FPS stays higher | `kmpCore` |
| H3 | Many tiny calls are slower in `kmpCore` because each one crosses the bridge | `jsCore` |
| H4 | List scrolling and animation performance are the same in both builds (control) | Tie |
| H5 | `kmpCore` has a slightly larger app size (Kotlin stdlib, Ktor, SQLDelight) | `jsCore` |
| H6 | Cold start differs by less than 10% | Tie / slight `jsCore` |
| H7 | A Baseline Profile improves `kmpCore` startup more than it improves `jsCore` | `kmpCore` + profile |

## 3. Repository Setup

### 3.1 Layout

```
pocketly/
├── apps/mobile/                     # single RN app (screens import only core-contract)
│   └── android/app/build.gradle     # productFlavors: jsCore, kmpCore
├── packages/
│   ├── core-contract/               # TS interface + shared types (the only thing UI imports)
│   ├── core-js/                     # TypeScript implementation
│   └── core-kmp/                    # TS wrapper around the Kotlin native module
├── shared/                          # KMP module
├── benchmarks/
│   ├── maestro/                     # flows: bm-01-start.yaml, bm-02-scroll.yaml, ...
│   ├── macrobenchmark/              # Android Gradle module (startup, frame timing)
│   ├── scripts/                     # run-all.sh, collect.ts, charts.ts
│   ├── fixtures/                    # seeded datasets (200 / 1k / 10k transactions)
│   └── results/
│       └── 2026-10-xx_<device>/     # raw JSON/CSV per run session
└── docs/performance-report.md
```

### 3.2 Android product flavors

```groovy
// apps/mobile/android/app/build.gradle
android {
    flavorDimensions "core"
    productFlavors {
        jsCore {
            dimension "core"
            applicationIdSuffix ".js"
            resValue "string", "app_name", "Pocketly JS"
        }
        kmpCore {
            dimension "core"
            applicationIdSuffix ".kmp"
            resValue "string", "app_name", "Pocketly KMP"
        }
    }
}

dependencies {
    kmpCoreImplementation project(":shared")   // jsCore ships with no Kotlin shared code
}
```

- Both builds install side by side: `com.pocketly.js` and `com.pocketly.kmp`.
- **JS bundle:** select the core at bundle time with an inlined env variable (e.g. `CORE_IMPL=kmp`), so the unused core is removed from the JS bundle. Otherwise `kmpCore` would also ship `core-js` code and the size comparison would be off.

```ts
// packages/core-contract/src/index.ts
export interface Core {
  getWallet(): Promise<Wallet>;
  getTransactions(cursor?: string, limit?: number): Promise<Page<Transaction>>;
  computeSpendingSummary(month: string): Promise<SpendingSummary>;
  ingestTransactions(json: string): Promise<number>;
  priceStream(symbols: string[]): Subscription<PriceTick[]>;
  // ...
}

// apps/mobile/src/core.ts
export const core: Core =
  process.env.CORE_IMPL === 'kmp' ? require('core-kmp').core : require('core-js').core;
```

### 3.3 Parity rules (both cores)

| ID | Rule |
|---|---|
| BM-PAR-01 | Both cores pass the **same contract test suite** (same inputs → same outputs) before any benchmark counts |
| BM-PAR-02 | Same algorithms. No "optimized in one, naive in the other" |
| BM-PAR-03 | Same storage engine underneath (SQLite), or storage is benchmarked as a separate scenario |
| BM-PAR-04 | Same fixtures, same random seed, same fake API latency |
| BM-PAR-05 | Same React Native version, Hermes on, minification on, release signing |

> **BM-PAR-03 in practice (ADR-0009):** both cores store data in SQLite, but through different
> libraries: `jsCore` uses op-sqlite (its own bundled SQLite, over JSI), `kmpCore` uses
> SQLDelight on the platform's SQLite. Same schema (generated from the same `.sq` files),
> different engine builds. So every scenario that touches storage reports it separately:
> `bench.lastStorageMs()` next to `bench.lastComputeMs()` (§5.2). Bulk writes follow the same
> pattern in both: one transaction, one prepared statement bound and stepped per row (from
> 2026-10-11; before that, `jsCore` re-prepared the statement for every row).

## 4. Environment & Test Rules

### 4.1 Devices

| Tier | Spec guideline | Why |
|---|---|---|
| **Low-end (required)** | ≤ 4 GB RAM, entry-level chipset | Most target users are on Android, and differences are largest here |
| **Mid-range (required)** | 6–8 GB RAM | Typical modern device |
| High-end (optional) | Flagship | Shows the ceiling |

Record each device's **model, chipset, RAM, Android version and build number** in the results folder.

### 4.2 Pre-run checklist

- [ ] **Release-optimized** builds of both flavors, freshly installed: `release`, or `perf` when the scenario needs launch arguments (§5.3). Never debug
- [ ] Device restarted at the start of the session
- [ ] Airplane mode on (the fake API is local), Wi-Fi/Bluetooth off
- [ ] Battery > 50%, same charging state for every run
- [ ] Fixed screen brightness, screen timeout disabled
- [ ] Refresh rate **pinned** in display settings (not adaptive), and recorded: run `device-info.sh` with `EXPECTED_HZ=<rate>`, which fails if the setting differs. The ROM can still run the app at a lower rate (the vivo V2538 runs Pocketly at 60 Hz with the setting at 120); BM-02 records the in-app rate per iteration
- [ ] Developer-option animation scales at **1x**
- [ ] No other apps open, and battery-saver / performance modes off
- [ ] Device temperature checked (`adb shell dumpsys battery` → temperature); 2 min cooldown between scenario batches. Record the temperature at the start of every block or run (BM-01: per launch; BM-02: `temperatures.csv`). Temperatures depend on the scenario (BM-01 sessions ran at ~35 °C; BM-02's continuous flinging needs a 40 °C gate), so compare builds within a scenario, never temperatures across scenarios
- [ ] Builds run **alternately** (js, kmp, js, kmp…) rather than all-js then all-kmp, so device drift affects both equally

### 4.3 Iterations & statistics

| Measurement type | Warm-up runs (discarded) | Measured runs |
|---|---|---|
| Startup (BM-01) | 2 | 20 |
| Flow-based (Flashlight) | 1 | 10 |
| Micro / operation timing (in-app harness) | 5 | 50 |

- Report **median, p90 and IQR**, plus the number of runs. Don't report averages alone.
- Report the **coefficient of variation** (CV). If CV is > 10%, the environment is too noisy: fix it and rerun.
  **For timings, the CV rule applies only to metrics with a median above 2 ms.** Below that, the
  spread is set by timer precision and scheduling jitter rather than by the environment: a
  0.1–0.3 ms wobble (a thread wake-up, a GC tick, clock granularity) is already more than 10% of
  a 1 ms median, and derived timings (bridge overhead = end-to-end − compute − storage) add up
  the jitter of three clocks. Sub-2 ms timings are still reported with their CV, IQR and CI;
  they just don't trigger a rerun. Non-time metrics (frame rate, CPU %, memory) keep the plain
  10% rule. (Added 2026-10-11, before the 2026-10-11 session; earlier summaries flag all rows.)
  **For rate metrics under 5% (e.g. janky frames), judge differences in absolute percentage
  points, not by CV.** A few frames move a 0.8% rate by a third, so its CV says nothing about
  the environment. `collect.ts` doesn't flag their CV; the shift and its CI are in points.
  (Added 2026-10-11, during that session's write-up.)
- **Rates under 5% are judged in absolute percentage points, for meaningfulness too** (added
  2026-10-17, before the BM-07 rerun). The rule above covered only the CV; a relative change
  still decided "meaningful", so a thread's CPU going from 4.6% to 4.2% (−0.4 points, −8.9%)
  counted as a difference. Now, when both builds' medians are under 5% (janky frames, a thread's
  CPU), a difference is meaningful only if the medians differ by **at least 1 point** and the
  IQRs don't overlap.
- **Short BM-07 steps are frame-quantized** (added 2026-10-17, before the BM-07 rerun). A step
  shorter than ~3 frames (median under 50 ms at the app's 60 Hz) moves by whole frames: a frame
  or two of scheduling is a large share of 20–30 ms. The CV rule doesn't apply to them, and a
  difference is meaningful only if the shift is **at least one frame (16.7 ms)** with
  non-overlapping IQRs. Longer steps follow the normal rules.
- **A difference becomes a finding only when it is meaningful in two sessions** (added
  2026-10-17, after BM-07's `mid-04` and `mid-05`). One session that passes the rule above (>5%
  with non-overlapping IQRs, or a special case) is reported as *open*, with both sessions' numbers,
  until a second session on the same code (or a trace that explains it) agrees. Example: BM-07's
  amount step, kmpCore −13 ms in `mid-04` (not meaningful) and −33 ms in `mid-05` (meaningful):
  open. Results already confirmed across sessions (for instance BM-02's control) stay as they are.
- **Keep every iteration that completed; exclude only failed ones**, and report how many were
  excluded. Flashlight: status `SUCCESS` is kept even if its trace lost events (that affects
  the frame-time trace of that iteration, not whether it ran). Harness: a cold start whose
  result was logged. Never drop an iteration because its numbers look odd. (`collect.ts` has
  worked this way since the first BM-02 session; written down 2026-10-11.)
- Treat a difference as meaningful only if it's **> 5%** *and* the IQRs don't overlap. Optional: a Mann-Whitney U test.

## 5. Tools

| Tool | Used for | Notes |
|---|---|---|
| **Flashlight** (`flashlight test`) | FPS, JS FPS, CPU per thread, RAM across Maestro flows | Main tool. No app setup needed. RAM is RSS only |
| **Maestro** | Repeatable user flows that drive Flashlight runs | One YAML per scenario in `benchmarks/maestro/` |
| **Jetpack Macrobenchmark** | Cold/warm startup (`StartupTimingMetric`), frame timing (`FrameTimingMetric`), Baseline Profile comparison | Targets each flavor by package name |
| **In-app benchmark harness** | Timing of individual core operations (BM-03, BM-04, BM-06) | Hidden screen inside the developer menu (FR-DEV) |
| **Perfetto** | Deep dives when a result is surprising | Add `Trace.beginSection()` in Kotlin |
| `adb shell dumpsys meminfo <pkg>` | PSS memory | Complements Flashlight's RSS |
| APK Analyzer, `bundletool get-size total` | App size | Compare per-ABI download size |

> **Change (2026-10-03): BM-01/BM-09 use platform startup logs, not Macrobenchmark.**
> On the mid-range device (vivo V2538, Android 16) Macrobenchmark 1.5.0 and 1.4.1 both hang
> after measuring (in a `cmd package dump` call that returns ~1 MB on this ROM), the test
> process is SIGKILLed with an empty results file, and `timeToFullDisplayMs` is never
> recorded. `benchmarks/scripts/bm-01-startup.sh` instead measures each cold start with
> `am start -W` and reads ActivityTaskManager's `Displayed` / `Fully drawn` lines, which use
> the same definitions as Android vitals. Compilation is set with `cmd package compile`
> (`verify` = `CompilationMode.None`; `speed-profile` for BM-09). Page cache can't be dropped
> without root, the same as Macrobenchmark on non-rooted devices. The Macrobenchmark module
> stays in `benchmarks/macrobenchmark/` for devices where it works.
>
> **Time to fully drawn** is reported natively in the draw pass of the first frame that
> contains `<FullyDrawnMarker />` (rendered once Home has data). Calling `reportFullyDrawn()`
> from a JS effect is too early: it runs before Fabric mounts the native views, so Android
> stamps an earlier, sometimes empty, frame.
>
> **Change (2026-10-05): BM-02 drives flings with `adb shell input`, not Maestro.** On the same
> device, Maestro 2.11's driver hangs or fails on the view-hierarchy call (120 s timeouts), while
> `uiautomator dump` takes ~3 s. `benchmarks/scripts/bm-02-scroll.sh` makes a fixed number of
> flings per pass (no screen reads while scrolling), and `bm-02-run.sh` runs it under Flashlight
> as three steps so that only the scrolling is measured: the cold start with launch arguments is
> `--beforeEachCommand`, the end-of-list check `--afterEachCommand` (with `--skipRestart`).
> Blocks of 2 iterations alternate builds and each waits until the battery is ≤ 40 °C: a first
> run without the gate drifted from 39 to 45 °C and skewed one build. The Maestro flow
> (`bm-02-scroll.yaml`) stays for devices where Maestro works.
>
> **Live feeds stay out of other scenarios.** Home has no price feed (Invest/F10 is hidden
> until it ships). When a live feed returns, it must not run during BM-01/BM-02: start it only
> after "fully drawn" and give it a launch flag that disables it. BM-05 measures it alone.

### 5.1 Example Flashlight run

```bash
# Verify flag names against the current Flashlight docs before running.
flashlight test \
  --bundleId com.pocketly.kmp \
  --testCommand "maestro test benchmarks/maestro/bm-05-stream.yaml" \
  --duration 15000 \
  --iterationCount 10 \
  --resultsFilePath benchmarks/results/<session>/bm-05-kmp.json \
  --resultsTitle "BM-05 kmpCore"

# Then the same for com.pocketly.js, and compare:
flashlight report benchmarks/results/<session>/bm-05-js.json benchmarks/results/<session>/bm-05-kmp.json
```

### 5.2 In-app benchmark harness

A screen in the developer menu that runs core operations N times and exports the results as JSON (shared to a file or logged to `adb logcat`).

It records **two timings** for every `kmpCore` operation:

| Timing | Measured where | Meaning |
|---|---|---|
| **End-to-end** | In JS with `performance.now()` around the `core.*` call | What the user actually experiences |
| **Compute only** | In Kotlin, inside the function | Pure native work |

**Bridge overhead = end-to-end − compute only.** For `jsCore`, end-to-end and compute are the same thing.

Operations that also touch SQLite record a third timing, **storage** (`bench.lastStorageMs()`),
which is kept out of compute in both cores:

| Operation | `lastComputeMs()` | `lastStorageMs()` |
|---|---|---|
| `computeSpendingSummary` (BM-03) | the calculation | reading the month's ledger from the replica |
| `ingestTransactions` (BM-04) | parse + validate | writing the accepted rows to the replica |
| `formatMoneyBatch` (BM-06) | formatting | 0 |

For `kmpCore`, bridge overhead is then end-to-end − compute − storage.

The timing getters, `formatMoneyBatch`, the ingest entry points and `echo` are `BenchCore`
methods (`packages/core-contract/src/bench.ts`), not `Core` methods: benchmark-only code is in
perf builds only (ADR-0003, "Benchmark-only code"; CI's `check-release-clean.sh`). They work on
the running core's own replica and timings, and BM-03 still times `Core.computeSpendingSummary`.

**Implementation** (`apps/mobile/src/bench/`, run by `benchmarks/scripts/bm-harness.sh`). A perf
build started with `pocketly.bench=BM-03|BM-04|BM-04b|BM-06` (plus `benchRuns`, `benchWarmup`, `benchMemory`) renders
only the harness screen, runs the scenario in-process and logs the result to logcat, where the
runner collects it. Inputs are built through the `Core` API rather than bundled files, so both
builds get byte-identical inputs (each result carries input and output checksums, compared by
`collect.ts`) and neither bundle grows (BM-08):

| Scenario | Setup (not timed) | Timed per run |
|---|---|---|
| BM-03 | `resetData({ seed: 7, transactionCount: 10000 })` (syncs the replica) | `computeSpendingSummary('2026-09')` |
| BM-04 | payload: the seed-2026 × 5,000 dataset paged out of the core, ids `in-…`, canonical JSON; before every run `resetData(DEFAULT_DATASET)` | `ingestTransactions(payload)` |
| BM-04b | as BM-04, plus `stageIngestPayload(payload)` before every run: the payload is already on the core's side, as a network response would be in a core that owns the network | `ingestStaged()` |
| BM-06 | 10,000 deterministic amounts | 10,000 × `formatMoney`, then 1 × `formatMoneyBatch`, then 10,000 × `echo` (call cost with no work: `echoEndToEndMs`) |

Each cold start runs the warm-up and measured iterations; rounds alternate builds and wait for
the battery to cool (`temperatures.csv`), as BM-02 does.

**Memory rounds** (`MEMORY=1 bm-harness.sh …`, BM-04's peak memory) are separate from the
timing rounds and go to `<scenario>/memory/`; their timings are not used. The app gets
`pocketly.benchMemory=true`, idles 1 s after the warm-up and logs `bench-mark` lines:
`measure-start`, `op-start <i>`/`op-end <i>` around each measured call (outside the timed
span), `measure-end`. Meanwhile `rss-sampler.sh`, running on the device, appends VmRSS and
VmSwap from `/proc/<pid>/status` every ~2–4 ms, timestamped with the shell's `$EPOCHREALTIME`,
the clock `logcat -v epoch` uses. After the run the runner saves `/proc/<pid>/status` (VmHWM)
and `dumpsys meminfo`. `collect.ts` reports, in MB:

| Metric | Per | Meaning |
|---|---|---|
| `rssStart` | cold start | median RSS over the first second of samples (~0.5 s after launch, before setup and warm-up) |
| `rssBaseline` | cold start | median RSS over the idle second before `measure-start`, i.e. **after** setup and the warm-up runs: it includes whatever the warm-up left behind |
| `rssPeak`, `rssPeakOverBaseline` | cold start | max RSS from `measure-start` to `measure-end`, and minus the baseline |
| `rssOpDelta` | measured call | max RSS during the call − the last sample before it |
| `vmHwm` | cold start | kernel peak RSS since process start (includes startup and setup) |
| `meminfoTotalPss`, `meminfoTotalRss`, `meminfoJavaHeapPss`, `meminfoNativeHeapPss` | cold start | `dumpsys meminfo` App Summary after the run |

RSS leaves out swapped pages, and this phone swaps to zram, so the verdict line counts rounds in
which VmSwap moved more than 1 MB. A peak shorter than the sampling interval can be missed.

```json
{
  "scenario": "BM-03",
  "build": "kmpCore",
  "device": "low-end-01",
  "warmup": 5,
  "runs": 50,
  "endToEndMs": [12.4, 11.9, ...],
  "computeMs": [9.8, 9.6, ...]
}
```

### 5.3 The `perf` build and launch arguments

Benchmarks install the **`perf`** build type (`assembleJsCorePerf`, `assembleKmpCorePerf`).
It is `release` in every respect (R8, bundled JS, Hermes, profileable, release signing, the
same package ids, so it installs over a release build) with one addition: it reads
**launch arguments**. A `release` build ignores them.

Launch arguments are `pocketly.*` intent extras. They are applied **before the first screen
loads**, so a cold start measures exactly the requested setup. (Dev links can't do that:
they arrive after the first load has started.) Unknown keys and bad values stop the app with a
visible error (`launch-args-error`) rather than letting it run on defaults.

| Extra | Values | Effect |
|---|---|---|
| `pocketly.tab` | `home`, `history`, `profile` | Start tab |
| `pocketly.seed`, `pocketly.transactionCount`, `pocketly.nowMillis` | integers | `resetData()` with this dataset before anything loads (unset fields: `LIVE_DATASET`'s) |
| `pocketly.network.mode`, `pocketly.network.normalLatencyMs`, `pocketly.network.failureRatePercent`, `pocketly.network.readTimeoutMs`, `pocketly.network.seed` | as `setNetworkSimulation` | Fake backend, same rules as the dev link |
| `pocketly.skipLock` | `true`, `false` | No PIN gate (FR-LOCK-01): the app opens straight to its tabs. BM-01/BM-09 and BM-02 always pass `true`; each session's NOTES says so. The harness (`pocketly.bench`) never shows the gate |

```bash
adb shell am start -W -n com.pocketly.kmp/com.pocketly.MainActivity \
  -e pocketly.tab history --ei pocketly.transactionCount 1000
```

Maestro's `launchApp: arguments:` sends the same extras (see `bm-02-scroll.yaml`). Arguments
are read at cold start only. A dataset argument resets the databases on **every** launch, so
leave it out of startup scenarios (BM-01/BM-09) unless the reset is part of what is measured.
iOS has no equivalent yet.

> **Change (2026-10-12, slice 5): BM-01/BM-09 run on `perf` builds with `pocketly.skipLock=true`.**
> With the PIN gate, a cold start on a release build stops at the lock screen, so Home's "fully
> drawn" never fires. `perf` differs from `release` only in reading launch arguments, so BM-01
> numbers stay comparable with earlier `release` sessions; the NOTES of the first session after
> the change should still say so. A later metric could time "cold start → lock screen", which is
> what users see first.

## 6. Scenarios

| ID | Scenario | Metrics | Tool | Tests |
|---|---|---|---|---|
| **BM-01** | **Cold start → Home rendered** with 200 cached transactions | Time to initial display, time to fully drawn | Platform startup logs (§5 note) | H6 |
| **BM-01-lock** | **Cold start → lock screen drawn** (added 2026-10-16), **release** builds, onboarded installs, biometrics off | Time to initial display, time to fully drawn (the lock screen's marker) | Platform startup logs, `TARGET=lock bm-01-startup.sh` | H6 |
| **BM-02** | **Scroll History, 1,000 items** (fling top → bottom ×3) | UI FPS, CPU per thread (JS, UI, Render), RAM. Flashlight has no JS FPS or frame overrun on Android | Flashlight + adb input (§5 note) | H4 (control) |
| **BM-03** | **Spending summary from 10,000 ledger entries** (group by category and day, totals, balance check) | End-to-end ms, compute ms | In-app harness | H1 |
| **BM-04** | **Ingest 5,000 transactions** from JSON → validate → write to SQLite cache | End-to-end ms, peak memory | In-app harness + `dumpsys meminfo` | H1 |
| **BM-04b** | BM-04 with the payload **already in the core** (staged before the timed call), as if the core had fetched it | End-to-end ms | In-app harness | H1 |
| **BM-05** | **Live price stream**: 20 assets × 10 ticks/s for 15 s, with throttled UI updates | JS-thread CPU, JS FPS, UI FPS, RAM | Flashlight + Maestro | H2 |
| **BM-06** | **Bridge stress**: 10,000 sequential tiny calls (e.g. `formatMoney`) and 1 batched call with 10,000 items | Total ms, ms per call | In-app harness | H3 |
| **BM-07** | **Full transfer flow** (Home → Send → amount → review → PIN → result), fake latency fixed at 300 ms | Flow duration, FPS during transitions, CPU | Flashlight + Maestro | H4 |
| **BM-08** | **App size** | APK size per ABI, download size, JS bundle size | APK Analyzer, bundletool | H5 |
| **BM-09** | **Startup with Baseline Profile** (BM-01 rerun with `CompilationMode.Partial(BaselineProfileMode.Require)`) | Same as BM-01 | Macrobenchmark | H7 |
| **BM-10** | **What-if: PBKDF2 without crypto libraries** (added 2026-10-16, ADR-0010 §8): `pbkdf2WhatIf` on the pin.json **60,000**-iteration vector, scaled ×10 to the PIN's 600,000 (notes below); pure JS (@noble/hashes, JS thread) vs pure Kotlin (KotlinCrypto HMAC, `Dispatchers.Default`). Never the PIN | Hash ms; longest JS-thread stall (4 ms timer probe); every run's hash checked | In-app harness | H1 (labelled what-if: the shipped PIN uses BM-11's libraries) |
| **BM-11** | **PIN unlock** (added 2026-10-12): `verifyPin` with the right PIN, PBKDF2-HMAC-SHA256 × 600,000 (ADR-0010) | Unlock ms; longest JS-thread stall while hashing (4 ms timer probe) | In-app harness | — (platform crypto in both builds: a cost check, not a hypothesis test) |

### Scenario notes

- **BM-02 is the control.** If the two builds differ noticeably, the setup is skewed (different dependencies, a debug build, etc.). Fix it before trusting any other result.
- **BM-04 vs BM-04b** (added 2026-10-11): BM-04 passes the 1.3 MB payload from JS into the core inside the timed call, which is the path when data starts in JS. In a KMP app whose core owns the network, the response arrives in Kotlin and never crosses the bridge; BM-04b measures that path. Report both.
- **BM-04 must follow BM-PAR-03.** The storage libraries differ (§3.3), so report "parse + validate" (`lastComputeMs`) and "write to DB" (`lastStorageMs`) as separate numbers.
- **BM-01-lock is what users see first** (decided 2026-10-16, before any BM-01-lock session).
  Since slice 5 every cold start opens on the lock screen (FR-LOCK-01), which is the same screen
  in both builds, while BM-01 needs `pocketly.skipLock` on perf builds to reach Home. Release
  builds ignore launch arguments, so BM-01-lock measures them as shipped: the lock screen renders
  `<FullyDrawnMarker />` and reports "fully drawn" (Home mounts only after unlock, so nothing
  else can report first). Before it reaches the screen, each core reads its auth state from
  secure storage (`getAuthState`). Both builds must be onboarded with biometrics off, or the
  biometric prompt would sit over the screen; the runner installs the release APKs over the
  onboarded apps (`adb install -r`, same ids and signing key) and never uninstalls. Same rounds
  and order as BM-01 (alternating, 2 warm-up + 20 measured, compilation `verify`). The PIN entry
  itself is not timed here (BM-11).
- **BM-01 reads the replica.** Data persists across launches (ADR-0009). The first launch after a fresh install seeds the fake server and syncs all 200 entries into an empty replica; later launches show the cached data, then sync a zero-entry delta. That first launch is one of the discarded warm-up runs, so the measured runs are all "cached" starts.
- **BM-02** uses the perf build with `pocketly.tab=history` and `pocketly.transactionCount=1000` (§5.3). Pages of 20 load from the replica while scrolling, as in normal use. Only the scrolling is measured (§5 note); its frame rate reflects the fling cadence as well as rendering, so compare builds within a run, not against 60 fps.
- **BM-06** compares the cost of chatty and batched bridge calls. The batched result tells you how to design the bridge API, which belongs in an ADR.
- **BM-11** times the shipped design: library or platform crypto in both builds (quick-crypto/OpenSSL vs javax.crypto on Android, CommonCrypto on iOS), so it answers "is 600,000 iterations fast enough on the slowest phone?" and "does the lock screen stay responsive?", not "JS vs Kotlin". BM-10 is that what-if. BM-11 replaces the install's PIN; run it on benchmark installs only.
- **BM-10 runs at 60,000 iterations, a tenth of the PIN's** (decided 2026-10-16, before any BM-10
  session). At 600,000, one jsCore run took 122.5 s on the vivo (kmpCore: 0.97 s; single-run
  check, 2026-10-16), so a standard session (5 rounds × (10 + 5 warm-up) per build) would keep
  jsCore busy for ~2.5 hours, with every run at risk of the screen timing out. PBKDF2's cost is
  linear in the iteration count (the same HMAC repeated), so `collect.ts` also reports
  `hashMsAt600k` = `hashMs` × 10, which is the number to set against BM-11's unlock time, always
  labelled as scaled. `jsMaxGapMs` is not scaled. Sessions use **3 rounds × 5 measured runs (+ 1
  warm-up per round) for both builds**, n = 15, smaller than usual (kmpCore could do more, but
  both builds get the same n); the session NOTES say so. jsCore holds one CPU core at full load
  for ~4 minutes, so builds alternate every round and the cooling check runs between blocks.
- **BM-10** answers "what does keeping crypto in the core's own language cost?", without native libraries on either side. Both are libraries, so neither side is hand-tuned by us: @noble/hashes 1.8.0 and KotlinCrypto 0.8.0 (only the PBKDF2 loop is ours, checked against pin.json). In jsCore it blocks the JS thread for the whole hash (noble's async variant yields only to microtasks), so `jsMaxGapMs` ≈ `hashMs` there: in a real app the lock screen would freeze. The freeze itself
  could be avoided by hashing in chunks that yield to the event loop (e.g. via `setTimeout`),
  which keeps the UI responsive but makes the total longer; the total time is the real problem
  either way. Report it as a what-if next to BM-11, never as the shipped unlock time. Touches no secrets, so any install works.
- **BM-07 drives the flow with adb input, and the app times its own steps** (decided 2026-10-17,
  before any BM-07 session). Maestro 2.11's driver died on the first tap on the vivo V2538, as in
  BM-02. `bm-07-run.sh` runs `bm-07-flow.sh` under Flashlight: the cold start with launch
  arguments (dataset reset to seed 42 / 200 entries, `normalLatencyMs` 300) and an unlock on the
  lock screen with the in-app PIN, as every real session starts (`skipLock` until
  `2026-10-17_mid-03`; changed with ADR-0014's in-memory phone, which the lock screen's auth read
  fills), is the `--beforeEachCommand`; the measured `--testCommand` taps Send → Andi → 150 → Review → Confirm
  → PIN at fixed times (1.5 s apart, 4 s after the PIN), reading nothing from the phone, so every
  iteration makes the same gestures and FPS/CPU cover the same window; the `--afterEachCommand`
  checks the result is Sent. Because the pacing is fixed, `flowMs` (Flashlight's iteration time)
  says little; the comparison is in the **step latencies** the app records itself with
  `performance.now()` (perf bundles only, `src/bench/flowMarks.tsx`): Send tap → recipients on
  screen, contact tap → amount screen, Review tap → review screen, Confirm tap → PIN screen, and
  PIN complete → result (PBKDF2 × 600,000, as BM-11, plus the 300 ms submit), with `appTotal`
  their sum. The result screen renders the marks in a hidden element that the runner reads with
  `uiautomator` after the measured window: logcat is not used because this ROM rate-limits app
  logging (`persist.log.ratelimit=1`) and dropped the marks. Biometrics stay off (the prompt
  needs a finger). Same rounds as BM-02: 5 alternating blocks × 2 iterations per build, one
  calibration flow and one warm-up per build first, the 40 °C gate between blocks.
- **BM-09** is reported as extra rows ("jsCore + profile", "kmpCore + profile"), not mixed into BM-01.

## 7. Results Storage

```
benchmarks/results/2026-10-xx_low-end-01/
├── device.json            # model, chipset, RAM, Android version, temperature log
├── bm-01-js.json          # raw Macrobenchmark output
├── bm-01-kmp.json
├── bm-02-js.json          # raw Flashlight output
├── ...
├── summary.csv            # one row per scenario × build: median, p90, IQR, CV, n
└── charts/                # generated by benchmarks/scripts/charts.ts
```

- Raw files are committed, never edited by hand.
- `summary.csv` and the charts are generated from raw files by script, so anyone can reproduce them.

## 8. Report Template (`docs/performance-report.md`)

```markdown
# Performance Report: bare RN vs RN + KMP

## TL;DR
3–5 bullets: where KMP won, where it lost, and the recommendation.

## Setup
Devices (from device.json), app version, RN/Kotlin/Hermes versions, methodology link.

## Hypotheses vs results
| ID | Hypothesis | Result | Confirmed? |

## Results by scenario
For each BM-xx: a table (median / p90 / IQR / n per build), one chart, 2–3 sentences of interpretation.

## Bridge overhead
Compute vs end-to-end breakdown (BM-03, BM-04, BM-06).

## App size
BM-08 table with a breakdown of what added the bytes.

## Limitations
Fake backend, limited devices, Android-focused, anything that went wrong.

## When I'd choose each
Concrete guidance: which kinds of apps/features justify KMP, and which don't.
```

## 9. Definition of Done

- [ ] BM-PAR-01 contract tests pass for both cores
- [ ] BM-02 control shows no meaningful difference
- [ ] All scenarios run on the low-end and mid-range devices
- [ ] Every result has CV ≤ 10%, or is rerun with the noise explained
- [ ] `summary.csv` and charts are generated by script from the raw results
- [ ] `performance-report.md` is written, with every hypothesis marked confirmed or rejected
- [ ] Key findings are linked from the main README
