#!/usr/bin/env bash
# BM-02: Flashlight over bm-02-scroll.sh, both builds (docs/benchmarking.md §4.3, §6).
#
#   benchmarks/scripts/bm-02-run.sh <results-dir> [blocks=5] [iterations-per-block=2]
#
# - Install the perf APKs first (launch arguments, §5.3):
#   ./gradlew assembleJsCorePerf assembleKmpCorePerf -PsplitApksByAbi && adb install -r …
# - Only the scrolling is measured: each iteration's cold start with launch arguments runs
#   as Flashlight's --beforeEachCommand, the end-of-list check as --afterEachCommand.
# - Small blocks alternate js, kmp, js, kmp… (§4.2), and each block waits until the battery
#   is at most COOL_C °C (default 40), so heat builds up evenly across the two builds.
#   A first run without the gate drifted from 39 to 45 °C and skewed the kmpCore block.
# - One unrecorded warm-up iteration per build first.
# - Raw Flashlight JSON: <results-dir>/bm-02/<block>-<build>.json. Never edited by hand.
set -euo pipefail

OUT_DIR="${1:?usage: bm-02-run.sh <results-dir> [blocks] [iterations-per-block]}"
BLOCKS="${2:-5}"
PER_BLOCK="${3:-2}"
COOL_C="${COOL_C:-40}"
FLASHLIGHT="${FLASHLIGHT:-$HOME/.flashlight/bin/flashlight}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SCROLL="$HERE/bm-02-scroll.sh"
RAW="$OUT_DIR/bm-02"

mkdir -p "$RAW"
adb get-state >/dev/null
[ -f "$OUT_DIR/device.json" ] || "$HERE/device-info.sh" "$OUT_DIR"

pkg_of() { [ "$1" = jsCore ] && echo com.pocketly.js || echo com.pocketly.kmp; }
battery_c() { adb shell dumpsys battery | awk -F': ' '/^ *temperature:/ {printf "%.1f", $2 / 10}'; }

cool_down() {
  local t
  t=$(battery_c)
  while awk -v t="$t" -v c="$COOL_C" 'BEGIN {exit !(t > c)}'; do
    echo "  cooling: battery $t °C > $COOL_C °C"
    adb shell input keyevent KEYCODE_HOME
    sleep 30
    t=$(battery_c)
  done
  echo "  battery $t °C"
}

echo "▸ warm-up (not recorded)"
for build in jsCore kmpCore; do
  "$SCROLL" "$(pkg_of $build)" all
done

for block in $(seq 1 "$BLOCKS"); do
  for build in jsCore kmpCore; do
    pkg=$(pkg_of $build)
    echo "▸ block $block/$BLOCKS $build × $PER_BLOCK"
    cool_down
    "$FLASHLIGHT" test \
      --bundleId "$pkg" \
      --skipRestart \
      --beforeEachCommand "$SCROLL $pkg prepare" \
      --testCommand "$SCROLL $pkg scroll" \
      --afterEachCommand "$SCROLL $pkg verify" \
      --iterationCount "$PER_BLOCK" \
      --resultsFilePath "$RAW/$(printf '%02d' "$block")-$build.json" \
      --resultsTitle "BM-02 $build (block $block)"
  done
done

cat > "$RAW/meta.json" <<JSON
{ "scenario": "BM-02", "warmup": 1, "blocks": $BLOCKS, "iterationsPerBlock": $PER_BLOCK,
  "order": "alternating blocks js,kmp", "coolDownToC": $COOL_C,
  "tool": "Flashlight test (--skipRestart, prepare/verify outside the measured command) + adb input (bm-02-scroll.sh)",
  "measured": "scrolling only: 3 passes x 96 swipes (80%→17% of height, 120 ms), History tab tap between passes",
  "dataset": { "seed": 42, "transactionCount": 1000 }, "build": "perf",
  "adbTransport": "${ANDROID_SERIAL:-default}",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
echo "▸ raw results in $RAW"
