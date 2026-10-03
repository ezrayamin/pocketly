# Pocketly — Benchmarking Plan

**Status:** Draft v0.1 · **Related:** `product.md`, `requirements.md` · **Last updated:** 2026-10-03
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

## 4. Environment & Test Rules

### 4.1 Devices

| Tier | Spec guideline | Why |
|---|---|---|
| **Low-end (required)** | ≤ 4 GB RAM, entry-level chipset | Most target users are on Android, and differences are largest here |
| **Mid-range (required)** | 6–8 GB RAM | Typical modern device |
| High-end (optional) | Flagship | Shows the ceiling |

Record each device's **model, chipset, RAM, Android version and build number** in the results folder.

### 4.2 Pre-run checklist

- [ ] **Release** builds of both flavors (never debug), freshly installed
- [ ] Device restarted at the start of the session
- [ ] Airplane mode on (the fake API is local), Wi-Fi/Bluetooth off
- [ ] Battery > 50%, same charging state for every run
- [ ] Fixed screen brightness, screen timeout disabled
- [ ] Developer-option animation scales at **1x**
- [ ] No other apps open, and battery-saver / performance modes off
- [ ] Device temperature checked (`adb shell dumpsys battery` → temperature); 2 min cooldown between scenario batches
- [ ] Builds run **alternately** (js, kmp, js, kmp…) rather than all-js then all-kmp, so device drift affects both equally

### 4.3 Iterations & statistics

| Measurement type | Warm-up runs (discarded) | Measured runs |
|---|---|---|
| Startup (BM-01) | 2 | 20 |
| Flow-based (Flashlight) | 1 | 10 |
| Micro / operation timing (in-app harness) | 5 | 50 |

- Report **median, p90 and IQR**, plus the number of runs. Don't report averages alone.
- Report the **coefficient of variation** (CV). If CV is > 10%, the environment is too noisy: fix it and rerun.
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

## 6. Scenarios

| ID | Scenario | Metrics | Tool | Tests |
|---|---|---|---|---|
| **BM-01** | **Cold start → Home rendered** with 200 cached transactions | Time to initial display, time to fully drawn | Platform startup logs (§5 note) | H6 |
| **BM-02** | **Scroll History, 1,000 items** (fling top → bottom ×3) | UI FPS, JS FPS, frame overrun, CPU | Flashlight + Maestro | H4 (control) |
| **BM-03** | **Spending summary from 10,000 ledger entries** (group by category and day, totals, balance check) | End-to-end ms, compute ms | In-app harness | H1 |
| **BM-04** | **Ingest 5,000 transactions** from JSON → validate → write to SQLite cache | End-to-end ms, peak memory | In-app harness + `dumpsys meminfo` | H1 |
| **BM-05** | **Live price stream**: 20 assets × 10 ticks/s for 15 s, with throttled UI updates | JS-thread CPU, JS FPS, UI FPS, RAM | Flashlight + Maestro | H2 |
| **BM-06** | **Bridge stress**: 10,000 sequential tiny calls (e.g. `formatMoney`) and 1 batched call with 10,000 items | Total ms, ms per call | In-app harness | H3 |
| **BM-07** | **Full transfer flow** (Home → Send → amount → review → PIN → result), fake latency fixed at 300 ms | Flow duration, FPS during transitions, CPU | Flashlight + Maestro | H4 |
| **BM-08** | **App size** | APK size per ABI, download size, JS bundle size | APK Analyzer, bundletool | H5 |
| **BM-09** | **Startup with Baseline Profile** (BM-01 rerun with `CompilationMode.Partial(BaselineProfileMode.Require)`) | Same as BM-01 | Macrobenchmark | H7 |

### Scenario notes

- **BM-02 is the control.** If the two builds differ noticeably, the setup is skewed (different dependencies, a debug build, etc.). Fix it before trusting any other result.
- **BM-04 must follow BM-PAR-03.** If the storage libraries differ, report "parse + validate" and "write to DB" as separate numbers.
- **BM-06** compares the cost of chatty and batched bridge calls. The batched result tells you how to design the bridge API, which belongs in an ADR.
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
