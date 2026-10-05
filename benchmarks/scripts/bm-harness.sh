#!/usr/bin/env bash
# In-app harness runs (BM-03, BM-04, BM-06; docs/benchmarking.md §5.2, §6).
#
#   benchmarks/scripts/bm-harness.sh <results-dir> <BM-03|BM-04|BM-06> [rounds=5] [runs=10] [warmup=5]
#
# - Needs the perf APKs installed (launch arguments, §5.3).
# - Each round cold-starts each build once with `pocketly.bench=<scenario>`; the app runs
#   `warmup` unrecorded + `runs` measured iterations in-process (apps/mobile/src/bench) and
#   logs the result in chunks, which this script joins into <scenario>/<round>-<build>.json.
#   rounds × runs measured per build (default 5 × 10 = 50, §4.3), builds alternating.
# - Before each launch: adb answers (else `adb reconnect`), and the battery is at most
#   COOL_C °C (default 40); the start temperature goes to <scenario>/temperatures.csv.
# - Raw files are never edited by hand. collect.ts summarizes them.
set -euo pipefail

OUT_DIR="${1:?usage: bm-harness.sh <results-dir> <BM-03|BM-04|BM-06> [rounds] [runs] [warmup]}"
SCENARIO="${2:?scenario BM-03|BM-04|BM-06}"
ROUNDS="${3:-5}"
RUNS="${4:-10}"
WARMUP="${5:-5}"
COOL_C="${COOL_C:-40}"
TIMEOUT_S="${TIMEOUT_S:-900}"
ACTIVITY="com.pocketly.MainActivity"
RAW="$OUT_DIR/$(tr A-Z a-z <<<"$SCENARIO")"

mkdir -p "$RAW"
[ -f "$RAW/temperatures.csv" ] || echo "round,build,startC,at" > "$RAW/temperatures.csv"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$OUT_DIR/device.json" ] || "$HERE/device-info.sh" "$OUT_DIR"

pkg_of() { [ "$1" = jsCore ] && echo com.pocketly.js || echo com.pocketly.kmp; }
battery_c() { adb shell dumpsys battery | awk -F': ' '/^ *temperature:/ {printf "%.1f", $2 / 10}'; }

adb_alive() { # adbd on the vivo V2538 sometimes stops answering while USB stays attached
  timeout 15 adb shell true >/dev/null 2>&1 && return 0
  echo "  adb not answering, reconnecting" >&2
  adb reconnect >/dev/null 2>&1
  sleep 5
  timeout 15 adb shell true >/dev/null 2>&1 || { echo "✗ adb lost the device" >&2; exit 1; }
}

cool_down() { # <round> <build>
  local t
  t=$(battery_c)
  while awk -v t="$t" -v c="$COOL_C" 'BEGIN {exit !(t > c)}'; do
    echo "  cooling: battery $t °C > $COOL_C °C"
    adb shell input keyevent KEYCODE_HOME
    sleep 30
    t=$(battery_c)
  done
  echo "$1,$2,$t,$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RAW/temperatures.csv"
  echo "  battery $t °C"
}

run_one() { # <round> <build>
  local round=$1 build=$2 pkg log deadline
  pkg=$(pkg_of "$build")
  adb_alive
  cool_down "$round" "$build"
  adb shell am force-stop "$pkg"
  adb logcat -c
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell am start -W -n "$pkg/$ACTIVITY" -e pocketly.bench "$SCENARIO" \
    --ei pocketly.benchRuns "$RUNS" --ei pocketly.benchWarmup "$WARMUP" >/dev/null
  deadline=$(($(date +%s) + TIMEOUT_S))
  while :; do
    sleep 5
    adb_alive
    log=$(adb logcat -d -s ReactNativeJS:V | tr -d '\r')
    grep -q "\[Pocketly\] bench-done $SCENARIO" <<<"$log" && break
    if grep -q "\[Pocketly\] bench-failed" <<<"$log"; then
      echo "✗ round $round $build: $(grep -o '\[Pocketly\] bench-failed.*' <<<"$log" | head -1)" >&2
      exit 1
    fi
    [ "$(date +%s)" -lt "$deadline" ] || { echo "✗ round $round $build: no result after ${TIMEOUT_S}s" >&2; exit 1; }
  done
  # Join the chunks in order (the log may hold several result sets if a run was retried).
  grep -oE '\[Pocketly\] bench-chunk [0-9]+/[0-9]+ .*' <<<"$log" |
    sed -E 's/^\[Pocketly\] bench-chunk [0-9]+\/[0-9]+ //' | tr -d '\n' > "$RAW/$(printf '%02d' "$round")-$build.json"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$RAW/$(printf '%02d' "$round")-$build.json" ||
    { echo "✗ round $round $build: result isn't valid JSON" >&2; exit 1; }
  adb shell am force-stop "$pkg"
}

for round in $(seq 1 "$ROUNDS"); do
  for build in jsCore kmpCore; do
    run_one "$round" "$build"
  done
  echo "  round $round/$ROUNDS ✓"
done

cat > "$RAW/meta.json" <<JSON
{ "scenario": "$SCENARIO", "rounds": $ROUNDS, "runsPerRound": $RUNS, "warmupPerRound": $WARMUP,
  "order": "alternating js,kmp per round, one cold start per build per round",
  "tool": "in-app harness (apps/mobile/src/bench) via launch arguments, perf builds",
  "coolDownToC": $COOL_C, "adbTransport": "${ANDROID_SERIAL:-default}",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
echo "▸ raw results in $RAW"
