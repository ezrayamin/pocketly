#!/usr/bin/env bash
# In-app harness runs (BM-03, BM-04, BM-04b, BM-06, BM-10, BM-11; docs/benchmarking.md §5.2, §6).
#
#   benchmarks/scripts/bm-harness.sh <results-dir> <BM-03|BM-04|BM-04b|BM-06|BM-10|BM-11> [rounds=5] [runs=10] [warmup=5]
#
# - Needs the perf APKs installed (launch arguments, §5.3).
# - Each round cold-starts each build once with `pocketly.bench=<scenario>`; the app runs
#   `warmup` unrecorded + `runs` measured iterations in-process (apps/mobile/src/bench) and
#   logs the result in chunks, which this script joins into <scenario>/<round>-<build>.json.
#   rounds × runs measured per build (default 5 × 10 = 50, §4.3), builds alternating.
# - Before each launch: adb answers (else `adb reconnect`), and the battery is at most
#   COOL_C °C (default 40); the start temperature goes to <scenario>/temperatures.csv.
# - Raw files are never edited by hand. collect.ts summarizes them.
# - On the vivo V2538 a cold start can come up with none of its log lines in logcat (seen
#   2026-10-11: the app ran and showed its result, logcat had nothing from its process). A
#   normal start logs ~150 lines within 2 s, so with fewer than 10 after LOG_CHECK_S (15 s)
#   the cold start is relaunched, at most MAX_RETRIES (2) times, and the retry is recorded in
#   <scenario>/retries.csv (benchmarking.md §4.3: exclude only failed iterations, say how many).
# - MEMORY=1: memory rounds, kept apart from the timing rounds in <scenario>/memory/. The app
#   logs bench-mark phase markers (pocketly.benchMemory) and rss-sampler.sh, running on the
#   device, records VmRSS/VmSwap every SAMPLE_S (default 0.002) into <round>-<build>-rss.txt.
#   At the end of each run: /proc/<pid>/status (VmHWM), `dumpsys meminfo`, and logcat with
#   epoch times (to line markers up with samples). Timings from these rounds aren't used.
set -euo pipefail

OUT_DIR="${1:?usage: bm-harness.sh <results-dir> <BM-03|BM-04|BM-04b|BM-06|BM-10|BM-11> [rounds] [runs] [warmup]}"
SCENARIO="${2:?scenario BM-03|BM-04|BM-04b|BM-06|BM-10|BM-11}"
ROUNDS="${3:-5}"
RUNS="${4:-10}"
WARMUP="${5:-5}"
COOL_C="${COOL_C:-40}"
TIMEOUT_S="${TIMEOUT_S:-900}"
ACTIVITY="com.pocketly.MainActivity"
MEMORY="${MEMORY:-0}"
SAMPLE_S="${SAMPLE_S:-0.002}"
RAW="$OUT_DIR/$(tr A-Z a-z <<<"$SCENARIO")"
[ "$MEMORY" = 1 ] && RAW="$RAW/memory"
MAX_RETRIES="${MAX_RETRIES:-2}"
LOG_CHECK_S="${LOG_CHECK_S:-15}"
SAMPLER=/data/local/tmp/pocketly-rss-sampler.sh
SAMPLES=/data/local/tmp/pocketly-rss.txt

mkdir -p "$RAW"
[ -f "$RAW/temperatures.csv" ] || echo "round,build,startC,at" > "$RAW/temperatures.csv"
[ -f "$RAW/retries.csv" ] || echo "round,build,attempt,reason,at" > "$RAW/retries.csv"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$OUT_DIR/device.json" ] || "$HERE/device-info.sh" "$OUT_DIR"
[ "$MEMORY" = 1 ] && adb push "$HERE/rss-sampler.sh" "$SAMPLER" >/dev/null

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

stop_sampler() { # the sampler ends by itself when the app's process goes; this is the backstop
  adb shell 'pkill -f "^sh /data/local/tmp/pocketly-rss-sampler"; pkill -f "^sleep 86398"' >/dev/null 2>&1 || true
}

launch() { # <pkg>: cold start with this scenario's launch arguments; prints the pid
  adb shell am force-stop "$1"
  adb logcat -c
  adb shell input keyevent KEYCODE_WAKEUP
  if [ "$MEMORY" = 1 ]; then
    stop_sampler
    adb shell rm -f "$SAMPLES"
  fi
  adb shell am start -W -n "$1/$ACTIVITY" -e pocketly.bench "$SCENARIO" \
    --ei pocketly.benchRuns "$RUNS" --ei pocketly.benchWarmup "$WARMUP" \
    -e pocketly.benchMemory "$([ "$MEMORY" = 1 ] && echo true || echo false)" >/dev/null
  adb shell pidof -s "$1" | tr -d '\r'
}

wait_result() { # <round> <build> <pid>: sets $log; returns 1 if the process logged nothing
  local started deadline checked=0 lines
  started=$(date +%s)
  deadline=$((started + TIMEOUT_S))
  while :; do
    sleep 5
    adb_alive
    log=$(adb logcat -d -s ReactNativeJS:V | tr -d '\r')
    grep -q "\[Pocketly\] bench-done $SCENARIO" <<<"$log" && return 0
    if grep -q "\[Pocketly\] bench-failed" <<<"$log"; then
      echo "✗ round $1 $2: $(grep -o '\[Pocketly\] bench-failed.*' <<<"$log" | head -1)" >&2
      exit 1
    fi
    if [ "$checked" = 0 ] && [ $(($(date +%s) - started)) -ge "$LOG_CHECK_S" ]; then
      checked=1
      lines=$(adb shell logcat -d --pid="$3" | wc -l | tr -d ' ')
      [ "$lines" -ge 10 ] || return 1
    fi
    [ "$(date +%s)" -lt "$deadline" ] || { echo "✗ round $1 $2: no result after ${TIMEOUT_S}s" >&2; exit 1; }
  done
}

run_one() { # <round> <build>
  local round=$1 build=$2 pkg log pid base attempt=1
  pkg=$(pkg_of "$build")
  base="$RAW/$(printf '%02d' "$round")-$build"
  adb_alive
  cool_down "$round" "$build"
  while :; do
    pid=$(launch "$pkg")
    [ -n "$pid" ] || { echo "✗ round $round $build: $pkg not running after start" >&2; exit 1; }
    if [ "$MEMORY" = 1 ]; then
      # The harness waits 500 ms, sets up, warms up, then idles MEMORY_SETTLE_MS before
      # measure-start: the sampler is running long before the baseline window.
      adb shell "nohup sh $SAMPLER $pid $SAMPLES $SAMPLE_S >/dev/null 2>&1 &"
    fi
    wait_result "$round" "$build" "$pid" && break
    echo "$round,$build,$attempt,no log lines from pid $pid after ${LOG_CHECK_S}s,$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RAW/retries.csv"
    adb shell am force-stop "$pkg"
    [ "$attempt" -le "$MAX_RETRIES" ] || { echo "✗ round $round $build: no log lines after $attempt launches" >&2; exit 1; }
    echo "  ⟳ no log lines from $pkg (pid $pid) after ${LOG_CHECK_S}s: relaunching"
    attempt=$((attempt + 1))
  done
  # Join the chunks in order.
  grep -oE '\[Pocketly\] bench-chunk [0-9]+/[0-9]+ .*' <<<"$log" |
    sed -E 's/^\[Pocketly\] bench-chunk [0-9]+\/[0-9]+ //' | tr -d '\n' > "$base.json"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$base.json" ||
    { echo "✗ round $round $build: result isn't valid JSON" >&2; exit 1; }
  if [ "$MEMORY" = 1 ]; then
    adb shell cat "/proc/$pid/status" | tr -d '\r' > "$base-status.txt"
    adb shell dumpsys meminfo "$pkg" | tr -d '\r' > "$base-meminfo.txt"
    adb logcat -d -v epoch -s ReactNativeJS:V | tr -d '\r' > "$base-logcat.txt"
  fi
  adb shell am force-stop "$pkg"
  if [ "$MEMORY" = 1 ]; then
    sleep 1 # the sampler notices the process is gone
    stop_sampler
    adb_alive
    timeout 60 adb exec-out cat "$SAMPLES" > "$base-rss.txt"
    adb shell rm -f "$SAMPLES"
    grep -q 'bench-mark measure-end' "$base-logcat.txt" ||
      { echo "✗ round $round $build: no bench-mark lines in logcat (old APK without benchMemory?)" >&2; exit 1; }
    echo "  $(wc -l < "$base-rss.txt" | tr -d ' ') RSS samples"
  fi
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
  "memory": $([ "$MEMORY" = 1 ] && echo "{ \"sampler\": \"rss-sampler.sh (VmRSS, VmSwap)\", \"intervalS\": $SAMPLE_S }" || echo false),
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
echo "▸ raw results in $RAW"
