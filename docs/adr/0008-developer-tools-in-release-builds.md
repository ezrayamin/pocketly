# ADR-0008: Developer tools ship in every build we produce

**Status:** Accepted · 2026-10-04 · Refines FR-DEV-01

## Context

FR-DEV-01 limits the developer menu to "debug/demo builds". But the demo video should show
failure states at release speed, BM-07 needs a fixed 300 ms latency in a **release** build,
and Maestro flows shouldn't depend on tapping a hidden version row 7 times to set up a run.

## Decision

- **One native switch, on by default.** `@pocketly/native-build-info` exposes
  `devToolsEnabled` from a native constant: Android bool resource `pocketly_dev_tools`
  (`app/build.gradle`), iOS Info.plist `PocketlyDevTools` ← build setting
  `POCKETLY_DEV_TOOLS` (default `YES`). Debug, demo and benchmark builds all have it on.
  A store build turns it off with `./gradlew … -PproductionBuild` / `xcodebuild POCKETLY_DEV_TOOLS=NO`.
  It's native, not a JS env flag, because Metro's transform cache and the Gradle daemon
  can serve a stale env value. Missing constant ⇒ off (fail closed).
- **Scriptable controls.** When enabled, the app handles
  `pocketly://dev/network?mode=…&failureRatePercent=…&normalLatencyMs=…&readTimeoutMs=…`,
  `pocketly://dev/reset` and `pocketly://dev/incoming` (partial network updates keep the
  rest; invalid values are rejected and logged). Maestro uses `openLink`; runners use
  `adb shell am start -a android.intent.action.VIEW -d <link>`.
- Both builds carry identical dev-tools code, so it doesn't affect the comparison.

## Consequences

- Dev-tools state is per app session (in the core's memory); flows set it at the start of each run.
- Benchmark builds now contain the menu code; it's inert unless used.
