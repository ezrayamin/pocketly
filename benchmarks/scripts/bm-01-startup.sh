#!/usr/bin/env bash
# BM-01: cold start → Home rendered (benchmarking.md §6), measured from Android's own
# startup logs — the same definitions Android vitals uses:
#   timeToInitialDisplayMs  ActivityTaskManager "Displayed <pkg>/…: +Nms"   (first frame)
#   timeToFullDisplayMs     ActivityTaskManager "Fully drawn <pkg>/…: +Nms" (JS called
#                           reportFullyDrawn() after wallet + recent txs rendered)
#
# Why not Macrobenchmark: on the vivo V2538 (Android 16) its test process hangs after
# measuring and is killed, and it never records TTFD. See docs/benchmarking.md §5.
#
#   benchmarks/scripts/bm-01-startup.sh <results-dir> [measured=20] [warmup=2] [compilation=none]
#
# - Fresh-installs both arm64 perf APKs (build first:
#   ./gradlew assembleJsCorePerf assembleKmpCorePerf -PsplitApksByAbi). perf = release plus
#   launch arguments (benchmarking.md §5.3); since slice 5 every launch passes
#   pocketly.skipLock=true, or the PIN gate (FR-LOCK-01) would keep Home from drawing.
# - compilation=none: `cmd package compile -f -m verify` (no AOT, = Macrobenchmark CompilationMode.None)
#   compilation=baselineProfile: speed-profile from the APK's baseline profile → BM-09
# - Alternates js, kmp, js, kmp… (§4.2). Warm-up runs are recorded; collect.ts drops them.
# - Page cache is NOT dropped between runs (needs root); identical for both builds.
set -euo pipefail

OUT_DIR="${1:?usage: bm-01-startup.sh <results-dir> [measured] [warmup] [compilation]}"
MEASURED="${2:-20}"
WARMUP="${3:-2}"
COMPILATION="${4:-none}"
SCENARIO=$([ "$COMPILATION" = "none" ] && echo "bm-01" || echo "bm-09")
ACTIVITY="com.pocketly.MainActivity"
SETTLE_SECONDS=2

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APK_DIR="$ROOT/apps/mobile/android/app/build/outputs/apk"
RAW="$OUT_DIR/$SCENARIO"

mkdir -p "$RAW"
adb get-state >/dev/null

pkg_of() { [ "$1" = jsCore ] && echo com.pocketly.js || echo com.pocketly.kmp; }

# On the vivo V2538, adbd sometimes stops answering while USB stays attached; `adb reconnect`
# recovers it. Check before each launch, and retry installs, rather than lose the session.
# (Uses coreutils `timeout`.)
adb_alive() {
  timeout 15 adb shell true >/dev/null 2>&1 && return 0
  echo "  adb not answering, reconnecting" >&2
  adb reconnect >/dev/null 2>&1
  sleep 5
  timeout 15 adb shell true >/dev/null 2>&1 || { echo "✗ adb lost the device" >&2; exit 1; }
}

install_apk() { # <apk>
  local attempt
  for attempt in 1 2 3; do
    adb_alive
    timeout 120 adb install "$1" >/dev/null 2>&1 && return 0
    echo "  install attempt $attempt failed, retrying" >&2
    sleep 5
  done
  echo "✗ couldn't install $1" >&2
  exit 1
}

echo "▸ fresh install + compilation=$COMPILATION"
for build in jsCore kmpCore; do
  pkg=$(pkg_of $build)
  adb uninstall "$pkg" >/dev/null 2>&1 || true
  install_apk "$APK_DIR/$build/perf/app-$build-arm64-v8a-perf.apk"
  case "$COMPILATION" in
    none) adb shell cmd package compile -f -m verify "$pkg" >/dev/null ;;
    baselineProfile)
      adb shell am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE "$pkg/androidx.profileinstaller.ProfileInstallReceiver" >/dev/null
      adb shell cmd package compile -f -m speed-profile "$pkg" >/dev/null ;;
    *) echo "compilation must be none|baselineProfile" >&2; exit 1 ;;
  esac
done

# "+432ms" or "+1s234ms" → milliseconds
to_ms() { sed -E 's/^\+//; s/^([0-9]+)s([0-9]+)ms$/\1*1000+\2/; s/ms$//' <<<"$1" | bc; }

run_one() { # <round> <build>
  local round=$1 build=$2 pkg
  pkg=$(pkg_of "$build")
  adb_alive
  local temp level
  temp=$(adb shell dumpsys battery | awk -F': ' '/^ *temperature:/ {print $2}' | tr -d '\r')
  level=$(adb shell dumpsys battery | awk -F': ' '/^ *level:/ {print $2}' | tr -d '\r')

  adb shell input keyevent KEYCODE_WAKEUP
  adb shell am force-stop "$pkg"
  sleep "$SETTLE_SECONDS"
  adb logcat -c

  local am launch_state am_total
  am=$(adb shell am start -W -n "$pkg/$ACTIVITY" -e pocketly.skipLock true | tr -d '\r')
  launch_state=$(awk -F': ' '/LaunchState/ {print $2}' <<<"$am")
  if [ -z "$launch_state" ]; then
    # No output at all is an adb hiccup, not a slow launch: stop the app and launch it again.
    echo "  round $round $build: am start returned nothing, relaunching" >&2
    adb shell am force-stop "$pkg"
    sleep "$SETTLE_SECONDS"
    adb logcat -c
    am=$(adb shell am start -W -n "$pkg/$ACTIVITY" -e pocketly.skipLock true | tr -d '\r')
    launch_state=$(awk -F': ' '/LaunchState/ {print $2}' <<<"$am")
  fi
  am_total=$(awk -F': ' '/TotalTime/ {print $2}' <<<"$am")
  if [ "$launch_state" != "COLD" ]; then
    echo "✗ round $round $build: launch was '$launch_state', not COLD" >&2
    exit 1
  fi

  # reportFullyDrawn() fires once Home data is rendered; wait up to 15s for it.
  local log displayed fully
  for _ in $(seq 1 30); do
    log=$(adb logcat -d -s ActivityTaskManager:I | tr -d '\r')
    fully=$(grep -oE "Fully drawn $pkg/[^:]*: \+[0-9sm]+" <<<"$log" | tail -1 | sed -E 's/.*: //' || true)
    [ -n "$fully" ] && break
    sleep 0.5
  done
  displayed=$(grep -oE "Displayed $pkg/[^:]*: \+[0-9sm]+" <<<"$log" | tail -1 | sed -E 's/.*: //' || true)
  if [ -z "$displayed" ] || [ -z "$fully" ]; then
    echo "✗ round $round $build: missing Displayed='$displayed' / Fully drawn='$fully'" >&2
    exit 1
  fi

  cat > "$RAW/$(printf '%02d' "$round")-$build.json" <<JSON
{ "round": $round, "build": "$build", "package": "$pkg", "launchState": "$launch_state",
  "timeToInitialDisplayMs": $(to_ms "$displayed"), "timeToFullDisplayMs": $(to_ms "$fully"),
  "amTotalTimeMs": ${am_total:-null}, "batteryTenthsCelsius": ${temp:-null}, "batteryPct": ${level:-null},
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
  adb shell input keyevent KEYCODE_HOME
}

TOTAL=$((WARMUP + MEASURED))
for round in $(seq 1 "$TOTAL"); do
  run_one "$round" jsCore
  run_one "$round" kmpCore
  label=$([ "$round" -le "$WARMUP" ] && echo "warm-up" || echo "measured")
  echo "  round $round/$TOTAL ($label) ✓"
done

cat > "$RAW/meta.json" <<JSON
{ "scenario": "$(tr a-z A-Z <<<"$SCENARIO")", "warmup": $WARMUP, "measured": $MEASURED,
  "compilation": "$COMPILATION", "order": "alternating js,kmp per round",
  "tool": "am start -W + ActivityTaskManager Displayed/Fully drawn (platform startup logs)",
  "settleSecondsBeforeLaunch": $SETTLE_SECONDS, "pageCacheDropped": false,
  "build": "perf", "launchArgs": { "pocketly.skipLock": "true" } }
JSON
echo "▸ raw results in $RAW"
