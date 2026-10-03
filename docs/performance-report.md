# Performance Report: bare RN vs RN + KMP

> **Status: not started.** Template from [benchmarking.md](benchmarking.md) §8. Every number in here must be
> generated from `benchmarks/results/**` by `benchmarks/scripts/` and never typed by hand.

## TL;DR
_3–5 bullets: where KMP won, where it lost, and the recommendation._

## Setup
- Devices: _from `device.json`_
- App: Pocketly `0.0.1` · React Native 0.87.1 (New Architecture, Hermes) · Kotlin 2.2.0 · Nitro Modules 0.37.1
- Methodology: [benchmarking.md](benchmarking.md)

## Hypotheses vs results
| ID | Hypothesis | Result | Confirmed? |
|---|---|---|---|
| H1 | CPU-heavy work is faster in Kotlin | | |
| H2 | JS-thread CPU is lower during streams in `kmpCore` | | |
| H3 | Many tiny calls are slower in `kmpCore` | | |
| H4 | Scrolling and animation are the same (control) | | |
| H5 | `kmpCore` is slightly larger | | |
| H6 | Cold start differs by < 10% | | |
| H7 | A Baseline Profile helps `kmpCore` more | | |

## Results by scenario
_For each BM-xx: a table (median / p90 / IQR / n per build), one chart, and 2–3 sentences of interpretation._

## Bridge overhead
_Compute vs end-to-end (BM-03, BM-04, BM-06). Compute = `core.lastComputeMs()`._

## App size
_BM-08. List `libNitroModules.so` separately: it ships in both builds (ADR-0003)._

## Limitations
- In-process fake backend; in-memory storage until SQLite lands (ADR-0004 §7).
- Android-first; iOS reported separately if at all.

## When I'd choose each
_Concrete guidance._
