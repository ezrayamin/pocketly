# Session 2026-10-17_mid-03

**BM-07 only**: the full transfer flow, Home → Send → Andi → $150 → review → PIN → result, fake
latency fixed at 300 ms (docs/benchmarking.md §6 and its BM-07 note). Flashlight + adb input
(`bm-07-run.sh` / `bm-07-flow.sh`); Maestro 2.11's driver dies on this phone. Raw files are never
edited; `summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code and device
- Perf APKs built from `90ba6b6` (slice 6 + the BM-07 tooling), freshly reinstalled over the
  onboarded installs before the session (same signing key, data kept: PIN set, biometrics off).
- vivo V2538, OS `16.0.21.0` (`PD2529DF_EX_A_16.0.21.0.W20`), refresh-rate setting pinned at
  120 Hz (`device.json`, `EXPECTED_HZ=120` checked).
- Checklist (§4.2): **restarted** (uptime 2 min at the check), **airplane mode on, Wi-Fi and
  Bluetooth off**, battery 92% on AC the whole session, fixed brightness, animation scales 1x,
  battery saver off, no other apps open. Battery 35.3–36.5 °C at block start (40 °C gate never
  waited).
- 5 alternating blocks × 2 iterations per build, after one calibration flow and one warm-up per
  build. **n = 10 per build, 0 iterations excluded.**

## Results (medians, n = 10 per build)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---|
| Send tap → recipients on screen | 521.5 ms | 440.8 ms | **−78 ms** (CI −95 to −70) |
| Contact tap → amount screen | 785.1 ms | 694.9 ms | **−91 ms** (CI −98 to −88) |
| Review tap → review screen | 23.9 ms | 20.6 ms | −3.5 ms |
| Confirm tap → PIN screen | 20.8 ms | 29.6 ms | not meaningful |
| PIN complete → result (PIN hash + 300 ms submit) | 622.1 ms | 997.1 ms | **+387 ms** (CI +365 to +414) |
| **App time, sum of steps** | **1,966.9 ms** | **2,198.3 ms** | **+216 ms (+11.8%)** |
| UI frame rate (Flashlight) | 58.4 fps | 58.4 fps | none |
| CPU, all threads | 26.0% | 29.8% | +3.8 points |
| CPU, JS thread | 4.6% | 4.2% | −0.4 points |
| CPU, UI / Render thread | 8.9% / 9.2% | 8.9% / 9.0% | none |
| RAM max (RSS) | 269.9 MB | 266.5 MB | none |

`flowMs` (Flashlight's measured span, 13.0 s in both) is set by the driver's fixed pacing and says
nothing about the cores; it is reported for completeness.

## What the numbers say
- **Frame rate is the same (H4 holds for transitions too).** 58.4 fps in both builds over the
  whole flow, with the UI and Render threads equally busy: where the core runs doesn't change how
  the screens animate.
- **The PIN decides the total.** The confirm step is +387 ms in kmpCore, within 10% of BM-11's
  quick-check gap for the same 600,000-iteration PBKDF2 (201 ms quick-crypto vs 554 ms
  javax.crypto, +353 ms; `2026-10-16_mid-01` NOTES). The 300 ms submit is the same in both. This
  is the platform crypto choice (ADR-0010 §8), not Kotlin vs JS: kmpCore uses the JVM's
  provider, jsCore OpenSSL. The extra hashing is also most of kmpCore's +3.8 points of total CPU
  (~350 ms more CPU work in a 13 s window ≈ +2.7 points).
- **kmpCore is ~80–90 ms faster on both steps that start a transfer.** Each of them reads this
  install's verified phone from secure storage (`getAuthState`, to rule out sending to yourself),
  then makes two (amount) or one (recipients) 300 ms backend calls. The gap matches the extra
  Keystore round trips react-native-sensitive-info makes on every read (~78 ms, traced in
  `2026-10-17_mid-01`). Not traced in this session: a hypothesis with a strong fit, not a
  measurement. If it holds, reading the phone once per flow (or keeping it in memory with the
  session) would remove most of it in jsCore, which is ADR-0002's "fewer, coarser reads" again.
- **The JS thread does slightly less in kmpCore** (−0.4 points), as expected with the core off it;
  at this flow's scale (a few calls per screen) it doesn't show in frames.

## Where kmpCore's extra CPU goes (added after the session, from the raw Flashlight files)

Mean CPU per thread family over all 10 iterations (points of one core, kmpCore − jsCore):

| Thread | jsCore | kmpCore | Δ |
|---|---:|---:|---:|
| `DefaultDispatch*` (Kotlin's coroutine pool: the core, its DB thread, PIN hashing) | 0.16 | 4.62 | **+4.47** |
| `mqt_v_js` (the JS thread) | 4.76 | 4.25 | −0.51 |
| `nitro-thread` (quick-crypto's PBKDF2) | 0.39 | 0.00 | −0.39 |
| `HeapTaskDaemon` (ART garbage collection) | 0.29 | 0.59 | +0.30 |
| everything else (UI, Render, binder, JIT, hwui…) | | | +0.2 |
| **Sum (Flashlight's own total)** | 25.84 | 29.90 | **+4.06** |

- No CPU is unaccounted for. The estimate above ("hashing ≈ 2.7 of the 3.8 points") was too low
  because it took BM-11's *wall-time* gap (+353 ms) as CPU. jsCore's hash costs ~50 ms of CPU on
  `nitro-thread` (0.39 points × 13 s): BM-11's 201 ms is mostly waiting (the PIN check's
  secure-storage reads, served by the Keystore in another process, which isn't the app's CPU).
  kmpCore's javax.crypto hash is real JVM work: `DefaultDispatch` spends ~600 ms of CPU per
  iteration, most of it the ~550 ms hash, and its allocations show up as +0.3 points of GC.
- Not traced: per-thread totals from Flashlight's 500 ms samples, read after the session.

- **Checklist deviation:** screen timeout left at 10 minutes, not disabled. The runner taps every
  1.5 s and wakes the screen before each launch, and every iteration completed, so it had no
  effect.
- `stepReview` and `stepPin` are 20–30 ms with CV > 10%: one or two frames of jitter on very short
  steps; `collect.ts` flags them. Neither changes a conclusion.
- One device, perf builds (release + launch arguments), fake in-process backend, biometrics off
  (the system prompt needs a finger), so the PIN path is the one measured.
- The step marks are the app's own `performance.now()` at the first effect after the screen's
  data arrives (before the frame is on the glass), the same in both builds.
