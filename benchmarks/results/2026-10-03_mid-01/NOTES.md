# Session 2026-10-03 · mid-01 · baseline on the near-empty app

Hand-written context for this session. All numbers live in the generated `summary.md` /
`summary.csv`; nothing here is a measurement.

- **Device:** vivo V2538, Snapdragon SM7750, 8 GB RAM, Android 16 (`device.json`). Mid-range tier.
  No low-end device was available, so the session is incomplete for the DoD.
- **App state:** M1 skeleton. Placeholder Home loads the wallet and 5 recent transactions,
  then renders `<FullyDrawnMarker />`; native code calls `reportFullyDrawn()` in the draw pass of
  the first frame containing it. No product screens.
- **Builds:** arm64-v8a release split APKs, R8 on, Hermes, signed with the debug key, profileable.
- **Checklist (§4.2):** restarted 47 min before the run, airplane mode on, Wi-Fi/BT off, battery
  75% on AC, animations 1x, screen timeout 10 min (run took ~2 min), battery 35.0–35.9 °C during
  the run, thermal status 0, load average ~1.6 at start. Android Studio closed (its adb restarts
  dropped the device during attempt 1).
- **BM-01:** platform startup logs instead of Macrobenchmark (see docs/benchmarking.md §5 note).
  2 warm-up + 20 measured per build, alternating, compilation=none, page cache not dropped.
- **BM-08:** APK file and compressed-entry sizes from split APKs. Not a Play download size
  (bundletool not installed; native libs are stored uncompressed in the APK).
- **Aborted:** `bm-01-aborted-1/` (adb dropped at round 16). Excluded from the summary.
- **Superseded:** `bm-01-superseded-1/`: complete run, but TTFD was reported from a JS effect
  (before native views were drawn), so it measured the wrong frame. Its TTID showed kmpCore
  +4.3% (p=0.010); the valid run (`bm-01/`) shows +1.1% (p=0.80) with identical TTID
  instrumentation, so that earlier gap was session drift, not a KMP cost. A single session of
  n=20 can't resolve differences this small; the report should compare across sessions/devices.
- **Valid BM-01 run:** after a restart (uptime 1 h 27 min), load ~1.5, battery 34.0–34.9 °C, all
  44 launches COLD. TTFD − TTID gap 20–53 ms in every run (never 0), as expected now that
  TTFD marks the frame where Home's views are actually drawn.
- **BM-08** re-measured on the same build as the valid BM-01 run.
