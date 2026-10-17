# Session 2026-10-16_mid-01

BM-10, the what-if of ADR-0010 §8: PBKDF2-HMAC-SHA256 written in each core's own language, with
no native crypto library. jsCore: @noble/hashes 1.8.0 on Hermes (JS thread). kmpCore: a PBKDF2
loop over KotlinCrypto 0.8.0's pure-Kotlin HMAC (`Dispatchers.Default`). **Not the shipped PIN**:
the PIN uses quick-crypto (OpenSSL) and javax.crypto, timed by BM-11. Raw files are never edited;
`summary.md` / `summary.csv` come from `benchmarks/scripts/collect.ts`.

## Code and device
- Perf APKs built from the commit with these results (on top of `4de821b`), which adds
  `pbkdf2WhatIf`, the BM-10 harness scenario and the 60,000-iteration vector in `pin.json`.
- vivo V2538, OS `16.0.21.0`, refresh-rate setting 120 Hz (`device.json`).
- **Differs from earlier sessions:** battery at 40% and charging (earlier: 100%), airplane mode
  off. BM-10 makes no network calls; charging adds heat, so the cooling check (≤ 40 °C between
  blocks) mattered more. Block-start temperatures stayed at 36.8–37.8 °C
  (`bm-10/temperatures.csv`).

## Method (benchmarking.md, BM-10; written before this session)
- **60,000 iterations**, a tenth of the PIN's 600,000: at 600,000 one jsCore run took 122.5 s on
  this phone, so a standard session would have taken ~2.5 hours. PBKDF2's cost is linear in the
  iteration count; `hashMsAt600k` = `hashMs` × 10, always labelled as scaled.
- **n = 15 per build, smaller than usual:** 3 rounds × 5 measured runs, 1 warm-up per round,
  builds alternating each round. Same n for both builds, though kmpCore could do far more.
- Every run's hash was checked against `pin.json` in the app (a mismatch aborts the run); both
  builds' input and output checksums are identical (`summary.md`, Verdicts).

## Results (medians, n = 15)

| | jsCore (noble, Hermes) | kmpCore (KotlinCrypto) |
|---|---:|---:|
| `hashMs`, 60,000 iterations | 11,772 ms | 91.0 ms |
| `hashMsAt600k` (scaled ×10) | 117.7 s | 0.91 s |
| `jsMaxGapMs` (longest JS-thread freeze) | 11,772 ms | 16.7 ms |
| CV of `hashMs` | 1.7% | 1.0% |

- **kmpCore is ~129× faster** with both sides in pure language code. The gap is Hermes, an
  interpreter without a JIT, doing 32-bit integer work; Node ran the same noble code at 600,000
  iterations in ~1.5 s (V8's JIT).
- **jsCore freezes the JS thread for the whole hash** (`jsMaxGapMs` = `hashMs`). noble's
  `pbkdf2Async` yields only to microtasks, so timers and rendering wait. Hashing in chunks that
  yield to the event loop (e.g. via `setTimeout`) would keep the UI responsive at the cost of a
  longer total; the total is the real problem either way. kmpCore runs off the JS thread; its
  ~17 ms gap is the probe's normal jitter (BM-11 shows the same).
- **Scaling check:** the single 600,000-iteration runs before this session (scratch, not in this
  folder; n = 1 each) took 122.5 s (jsCore) and 0.97 s (kmpCore), within 4% and 7% of the
  scaled medians.

## Against the shipped design (BM-11, 2026-10-12 quick check, 600,000 iterations)

| Unlock at 600,000 | jsCore | kmpCore |
|---|---:|---:|
| Shipped (BM-11): native crypto libraries | 201 ms (quick-crypto, OpenSSL in C) | 554 ms (javax.crypto, BouncyCastle in Java) |
| What-if (BM-10, scaled): pure language code | 117.7 s | 0.91 s |

Without native crypto, a 600,000-iteration PIN is unusable in jsCore (~2 minutes, UI frozen) and
still fine in kmpCore (under 1 s, off the JS thread). That is the case for quick-crypto in
ADR-0010 §8: jsCore *needs* a native library for this work, kmpCore doesn't. The BM-11 numbers
above come from a 2 × 10-run quick check, not a full session; BM-11's full run is due with the
step-5 reruns.

## Limitations: checklist deviations (benchmarking.md §4.2)

Same as `2026-10-17_mid-01`, noted after the fact: **airplane mode off**, **Bluetooth on**, battery
**40%** and charging, device **not restarted**. The jsCore/kmpCore ratio (~129×) is far beyond
any noise these could add, and both builds ran alternately under the same conditions; absolute
times may be slightly noisier than usual.
