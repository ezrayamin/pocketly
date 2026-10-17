#!/usr/bin/env bash
# BM-07: Flashlight over bm-07-flow.sh, both builds (docs/benchmarking.md §4.3, §6).
#
#   PIN=<in-app test PIN> benchmarks/scripts/bm-07-run.sh <results-dir> [blocks=5] [iterations-per-block=2]
#
# - Install the perf APKs first (launch arguments, §5.3), onboarded with the in-app test PIN,
#   biometrics off.
# - Each iteration: cold start with launch arguments (dataset reset, latency 300 ms) as
#   Flashlight's --beforeEachCommand; the flow from the Send tap to the result as the measured
#   --testCommand; the result check and the app's step marks as --afterEachCommand.
# - Blocks alternate js, kmp, js, kmp… (§4.2); each waits until the battery is at most COOL_C °C
#   (default 40), as BM-02. One calibration flow per build first (finds the controls; also the
#   unrecorded warm-up), then one more unrecorded warm-up iteration.
# - Raw: <results-dir>/bm-07/<block>-<build>.json (Flashlight), bm-07/marks/<block>-<build>/<n>.txt
#   (the app's flow-mark lines), bm-07/temperatures.csv. Never edited by hand.
set -euo pipefail

OUT_DIR="${1:?usage: PIN=… bm-07-run.sh <results-dir> [blocks] [iterations-per-block]}"
BLOCKS="${2:-5}"
PER_BLOCK="${3:-2}"
COOL_C="${COOL_C:-40}"
: "${PIN:?PIN (the in-app test PIN) is required}"
export PIN
FLASHLIGHT="${FLASHLIGHT:-$HOME/.flashlight/bin/flashlight}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FLOW="$HERE/bm-07-flow.sh"
RAW="$OUT_DIR/bm-07"

mkdir -p "$RAW"
[ -f "$RAW/temperatures.csv" ] || echo "block,build,startC,at" > "$RAW/temperatures.csv"
adb get-state >/dev/null
[ -f "$OUT_DIR/device.json" ] || "$HERE/device-info.sh" "$OUT_DIR"

pkg_of() { [ "$1" = jsCore ] && echo com.pocketly.js || echo com.pocketly.kmp; }
coords_of() { echo "$RAW/coords-$1.txt"; }
battery_c() { adb shell dumpsys battery | awk -F': ' '/^ *temperature:/ {printf "%.1f", $2 / 10}'; }

cool_down() { # <block> <build>: wait until ≤ COOL_C, then record the start temperature
  local t
  t=$(battery_c)
  while awk -v t="$t" -v c="$COOL_C" 'BEGIN {exit !(t > c)}'; do
    echo "  cooling: battery $t °C > $COOL_C °C"
    adb shell input keyevent KEYCODE_HOME
    sleep 30
    t=$(battery_c)
  done
  echo "  battery $t °C"
  echo "$1,$2,$t,$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RAW/temperatures.csv"
}

echo "▸ calibration + warm-up (not recorded)"
for build in jsCore kmpCore; do
  pkg=$(pkg_of $build)
  COORDS="$(coords_of $build)" "$FLOW" "$pkg" calibrate
  COORDS="$(coords_of $build)" "$FLOW" "$pkg" all
done

for block in $(seq 1 "$BLOCKS"); do
  for build in jsCore kmpCore; do
    pkg=$(pkg_of $build)
    tag="$(printf '%02d' "$block")-$build"
    echo "▸ block $block/$BLOCKS $build × $PER_BLOCK"
    cool_down "$block" "$build"
    COORDS="$(coords_of $build)" MARKS_DIR="$RAW/marks/$tag" "$FLASHLIGHT" test \
      --bundleId "$pkg" \
      --skipRestart \
      --beforeEachCommand "$FLOW $pkg prepare" \
      --testCommand "$FLOW $pkg run" \
      --afterEachCommand "$FLOW $pkg verify" \
      --iterationCount "$PER_BLOCK" \
      --resultsFilePath "$RAW/$tag.json" \
      --resultsTitle "BM-07 $build (block $block)"
  done
done

cat > "$RAW/meta.json" <<JSON
{ "scenario": "BM-07", "warmup": 1, "blocks": $BLOCKS, "iterationsPerBlock": $PER_BLOCK,
  "order": "alternating blocks js,kmp", "coolDownToC": $COOL_C,
  "tool": "Flashlight test (--skipRestart, prepare/verify outside the measured command) + adb input at fixed times (bm-07-flow.sh); step latencies from the app's own marks",
  "measured": "Send tap → result shown: recipient Andi, amount 150, review, PIN (biometrics off), taps ${STEP_S:-1.5} s apart, ${CONFIRM_S:-4} s after the PIN",
  "dataset": { "seed": 42, "transactionCount": 200 }, "network": { "mode": "NORMAL", "normalLatencyMs": 300 }, "build": "perf",
  "adbTransport": "${ANDROID_SERIAL:-default}",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
echo "▸ raw results in $RAW"
