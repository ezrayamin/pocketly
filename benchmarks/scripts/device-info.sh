#!/usr/bin/env bash
# Writes <results-dir>/device.json for the connected Android device (benchmarking.md §4.1, §7).
# Usage: benchmarks/scripts/device-info.sh benchmarks/results/2026-10-xx_low-end-01
set -euo pipefail

OUT_DIR="${1:?usage: device-info.sh <results-dir>}"
mkdir -p "$OUT_DIR"

prop() { adb shell getprop "$1" | tr -d '\r'; }
mem_kb=$(adb shell cat /proc/meminfo | awk '/MemTotal/ {print $2}')
temp=$(adb shell dumpsys battery | awk -F': ' '/^ *temperature:/ {print $2}' | tr -d '\r')
level=$(adb shell dumpsys battery | awk -F': ' '/^ *level:/ {print $2}' | tr -d '\r')

cat > "$OUT_DIR/device.json" <<JSON
{
  "model": "$(prop ro.product.model)",
  "manufacturer": "$(prop ro.product.manufacturer)",
  "chipset": "$(prop ro.soc.model)",
  "ramMb": $((mem_kb / 1024)),
  "androidVersion": "$(prop ro.build.version.release)",
  "sdkInt": $(prop ro.build.version.sdk),
  "buildNumber": "$(prop ro.build.display.id)",
  "capturedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "temperatureLog": [{ "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "tenthsCelsius": ${temp:-null}, "batteryPct": ${level:-null} }]
}
JSON
echo "wrote $OUT_DIR/device.json"
