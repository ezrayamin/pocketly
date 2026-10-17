# Session 2026-10-17_mid-05

**BM-07 repeat of `2026-10-17_mid-04`**, as §4.3 asks: one disturbed kmpCore iteration there
pushed the CPU rows' CV over 10%. Same perf APKs (app code as of `fa3b222`; later commits touched
only scripts, docs and results), same runner, flow, latency (300 ms) and lock-screen unlock in
`prepare`, same rules. Raw files are never edited; `summary.md` / `summary.csv` come from
`benchmarks/scripts/collect.ts`.

## Code and device
- Perf APKs as in mid-04, freshly reinstalled (`c9036de` checked out, clean tree).
- vivo V2538, OS `16.0.21.0`, refresh-rate setting pinned at 120 Hz (`device.json`,
  `EXPECTED_HZ=120` checked).
- Checklist (§4.2): **restarted** (uptime 95 s at the check), **airplane mode on, Wi-Fi and
  Bluetooth off**, battery 100% on AC, fixed brightness, animation scales 1x, battery saver off,
  no other apps open. Battery 37.0 °C at the check, 35.2–35.4 °C at block start.
- 5 alternating blocks × 2 per build after one calibration flow and one warm-up per build.
  **n = 10 per build, 0 excluded, no CV warning on any metric.**

## Results (medians, n = 10 per build)

| | jsCore | kmpCore | kmpCore − jsCore |
|---|---:|---:|---|
| Send → recipients on screen | 361.6 ms | 357.3 ms | −4 ms, not meaningful |
| Contact → amount screen | 418.2 ms | 385.6 ms | −33 ms (CI −46 to −25), meaningful (−7.8%) |
| Review → review screen | 44.8 ms | 48.0 ms | frame-quantized, not meaningful |
| Confirm → PIN screen | 37.0 ms | 41.2 ms | frame-quantized, not meaningful |
| PIN → result (PBKDF2 + 300 ms submit) | 629.8 ms | 962.8 ms | +340 ms (CI +308 to +362) |
| **App time, sum of steps** | **1,477.8 ms** | **1,785.7 ms** | **+301 ms (+20.8%)** |
| UI frame rate | 58.0 fps | 58.1 fps | none |
| CPU, all threads | 27.9% | 31.8% | **+4.0 points** (CI +3.5 to +4.6) |
| CPU, JS / UI / Render thread | 5.3 / 9.6 / 9.2% | 5.5 / 9.6 / 9.3% | none of them meaningful |
| RAM max (RSS) | 262.7 MB | 290.8 MB | **+27.9 MB** (CI +26.4 to +29.0) |

## Against mid-04
- **The CPU rows are clean now and agree with mid-03's breakdown.** kmpCore's +4.0 points are its
  coroutine pool (`DefaultDispatch` +3.9, the PIN hash in javax.crypto) and GC
  (`HeapTaskDaemon` +0.4), less quick-crypto's `nitro-thread` (−0.4) on jsCore's side. JS, UI and
  Render threads are the same in both builds.
- **mid-04's Render-thread "+0.6 points" was the disturbed iteration**: +0.2 points here, not
  meaningful (and +0.0 in mid-03).
- **RAM confirmed:** kmpCore again starts the flow ~28 MB larger after the lock-screen unlock
  (240 vs 268 MB median RSS at the first sample) and peaks +27.9 MB higher (mid-04: +25.9 MB).
- **Steps confirmed:** recipients equal (mid-04 −5 ms, here −4 ms); PIN +340 ms (mid-04 +344 ms);
  app time 1.48 s vs 1.79 s (mid-04 1.46 vs 1.79 s).
- **The amount step differs by session:** jsCore 385.8 ms in mid-04, 418.2 ms here (kmpCore 387.2
  → 385.6 ms), so −13 ms (not meaningful) there and −33 ms (meaningful by the rule) here. One of
  two sessions; both steps run the same two parallel 300 ms calls. Not called a finding: it needs
  a third session or a trace before it's reported as one.

## Limitations
- **Checklist deviation:** screen timeout at 10 minutes, not disabled (as in mid-03/04); every
  iteration completed.
- Same scope as mid-03/04: one device, perf builds, fake in-process backend, biometrics off;
  marks taken in a JS effect before the frame is drawn (~20–50 ms early in absolute terms).
