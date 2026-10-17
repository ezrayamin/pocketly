# Session 2026-10-17_mid-04

**BM-07 rerun** after the two app fixes that `2026-10-17_mid-03` pointed to (commit `fa3b222`,
ADR-0014 §6): the user's phone is kept in memory instead of three secure-storage reads per Send
screen, and `startTransfer` makes its backend calls in parallel. Method changes written down
before this session (`a0aff6f`, benchmarking.md §4.3 and the BM-07 note): rates under 5% judged
in points, steps under 50 ms frame-quantized, and each iteration now **unlocks on the lock screen
with the in-app PIN** in the unmeasured `prepare` step (mid-03 used `skipLock`). Raw files are
never edited; `summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code and device
- Perf APKs built from `a0aff6f` (app code as of `fa3b222`), freshly reinstalled over the
  onboarded installs (PIN set, biometrics off).
- vivo V2538, OS `16.0.21.0`, refresh-rate setting pinned at 120 Hz (`device.json`,
  `EXPECTED_HZ=120` checked).
- Checklist (§4.2): **restarted** (uptime 58 s at the check), **airplane mode on, Wi-Fi and
  Bluetooth off**, battery 100% on AC, fixed brightness, animation scales 1x, battery saver off,
  no other apps open. Battery 34.9–35.4 °C at block start.
- 5 alternating blocks × 2 iterations per build, after one calibration flow and one warm-up per
  build. **n = 10 per build, 0 excluded.**

## Measured, then fixed (medians, n = 10 per build each)

| Step | jsCore mid-03 → mid-04 | kmpCore mid-03 → mid-04 | kmpCore − jsCore, mid-03 → mid-04 |
|---|---|---|---|
| Send → recipients on screen | 521.5 → **362.1 ms** (−159) | 440.8 → **355.5 ms** (−85) | −78 ms → **−5 ms, not meaningful** |
| Contact → amount screen | 785.1 → **385.8 ms** (−399) | 694.9 → **387.2 ms** (−308) | −91 ms → **−13 ms, not meaningful** |
| Review → review screen | 23.9 → 33.0 ms | 20.6 → 40.2 ms | frame-quantized, not meaningful |
| Confirm → PIN screen | 20.8 → 38.5 ms | 29.6 → 40.3 ms | frame-quantized, not meaningful |
| PIN → result (PBKDF2 + 300 ms submit) | 622.1 → 628.4 ms | 997.1 → 965.5 ms | +387 ms → **+344 ms** (CI +321 to +371) |
| **App time, sum of steps** | 1,966.9 → **1,459.8 ms (−26%)** | 2,198.3 → **1,787.2 ms (−19%)** | +216 ms → **+332 ms** |
| UI frame rate | 58.4 → 57.9 fps | 58.4 → 58.0 fps | none → none |

- **Both fixes did what they should.** The amount step lost one 300 ms round trip in both builds
  (parallel calls) plus, in jsCore, its secure-storage reads; the recipients step lost the reads.
  The two steps that differed by library now differ by 5 and 13 ms, inside the noise.
- **What's left between the builds is the PIN.** +344 ms in the confirm step, the
  javax.crypto vs quick-crypto gap seen in BM-11. The total gap grew (+216 → +332 ms) only because
  kmpCore's former advantage on the secure-storage steps is gone.
- **For a user**, sending money got ~0.4–0.5 s faster in both builds: the biggest change in this
  flow came from the app's own call pattern, not from where the core runs.
- The short steps moved by a frame or so (both builds); §4.3's frame rule calls them equal.

## New in this session: memory and CPU after a real unlock

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---|
| RSS at the start of the measured flow (median) | 245 MB | 274 MB | +29 MB |
| RAM max during the flow | 265.3 MB | 291.8 MB | **+25.9 MB (shift), meaningful** |
| CPU, all threads | 27.6% | 32.0% | +4.7 points (kmpCore CV 14%) |
| CPU, Render thread | 8.9% | 9.5% | +0.6 points (kmpCore CV > 10%) |


- **RAM:** in mid-03 (no unlock) both builds started the flow at ~232 MB and peaked within 2 MB.
  Here each iteration unlocks first, and kmpCore starts ~29 MB higher: its PIN check (600,000
  PBKDF2 iterations in javax.crypto, JVM allocations) grows the ART heap, and RSS stays there, as
  BM-04's memory rounds saw after heavy Kotlin work. jsCore hashes in OpenSSL (native). This
  matters more than the flow itself: every real session starts with an unlock.
- **CPU:** kmpCore's coroutine pool is again the difference (+3.95 points `DefaultDispatch`, the
  PIN hash), as mid-03's addendum found.

## Limitations
- **CV > 10% for kmpCore's CPU rows (all threads, JS, UI, Render).** One iteration (block 1, the
  second kmpCore one) ran with everything on the device busier at once: total CPU 46.9% (others
  31–33%), UI 15.7% and Render 14.3% (others ~9–10%), 50.6 fps (others ~58) and 0.7 s longer.
  Something outside the app; §4.3 keeps every completed iteration, so it is in. The Render-thread
  "meaningful" +0.6 points was absent in mid-03 and isn't explained; the CPU rows of this session
  need a rerun per §4.3 before they're quoted. The step latencies (CV ≤ 6.6%, short steps exempt)
  and RAM are not affected by it.
- **Checklist deviation:** screen timeout at 10 minutes, not disabled (as in mid-03); every
  iteration completed.
- Same scope as mid-03: one device, perf builds, fake in-process backend, biometrics off; marks
  are taken in a JS effect before the frame is drawn (~20–50 ms early in absolute terms).
