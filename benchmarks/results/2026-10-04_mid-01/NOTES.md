# Session 2026-10-04 · mid-01 · M1 Home slice

Hand-written context. All numbers come from the generated `summary.md` / `summary.csv` or
the traces in `traces/` (git-ignored, local only); nothing here is a new measurement.

- **Code:** tag `m1-home` (commit `ba54bfc`). Release builds, R8 on, Hermes, debug-key signed, profileable.
- **Device:** vivo V2538, Snapdragon SM7750, 8 GB, Android 16 (`device.json`). Mid-range tier only;
  no low-end device yet.
- **Screen under test:** the real Home (balance card, monthly change, daily-limit bar, incoming
  banner, quick actions, 5 recent transactions, 4-tab bar). No live price feed on Home.
- **Same state in both builds:** fresh install at session start → balance visible (UI preference
  default), banner showing (dismissal isn't persisted). Nothing cleared or touched between runs.
- **Fully drawn:** reported natively in the draw pass of the first frame containing
  `<FullyDrawnMarker />`, which renders in the same React commit as the wallet, the recent list
  and the monthly summary (`useHomeData` sets all three at once).
- **Checklist (§4.2):** restarted ~6 min before the cooldown; waited until thermal status 0,
  battery < 37 °C and 1-min load < 3 (reached at 35.4 °C, load 1.8). Airplane mode on, Wi-Fi
  radio off (note: "Wi-Fi scanning always available" was on), Bluetooth off, AC power
  throughout, animations 1x, Android Studio closed. Battery 34.5–34.7 °C during BM-01.
  The phone dropped off adb for ~3 min *during the cooldown* (before any measurement).
- **BM-01:** platform startup logs (docs/benchmarking.md §5 note), 2 warm-up + 20 measured per
  build, alternating, `verify` compilation, page cache not dropped. All 40 measured launches COLD.
- **BM-08:** split APKs (`apk-size.ts`) **and** real per-ABI download sizes via bundletool 1.18.3
  `get-size total` (`bm-08-download/`). APKs store native libs uncompressed; Play's download
  compresses them, so the download delta is about a third of the APK delta.

## Reading the numbers against the skeleton session

The jump in time to fully drawn, from ~294 ms (skeleton, `2026-10-03_mid-01`) to ~474–481 ms
here, is **expected: it's the cost of a real screen, paid equally by both builds.** Comparisons
are valid only within a session (jsCore vs kmpCore); across sessions the screen differs.

Where the time goes (one Perfetto cold start per build, `traces/`, query `traces/q2.sql`):
after the first frame, the UI thread spends ~170 ms on Fabric mounting (`premountViews`,
`mountViews`) and measure/layout/draw (`traversal`) of Home's native views (incl. SVG icons and
the gradient), while the JS thread runs ~145 ms (bundle + React render). Per-thread CPU is
nearly identical between builds (main ~244 ms, JS 143–150 ms, RenderThread ~70 ms); Kotlin's
own threads are negligible (`DefaultDispatch` 1.9 ms). Startup is dominated by RN rendering,
not by where the business logic runs. Single traces: indicative, not statistics.

## Shared cost, not part of the comparison

The ~170 ms of UI-thread mounting and drawing after the first frame (SVG icons, the gradient,
the list) is paid equally by both builds. Optimizing it (e.g. lighter icons) would speed up
both builds alike: a UX improvement, deferred, and not a KMP finding.
