#!/usr/bin/env bash
# Writes <results-dir>/device.json for the connected Android device (benchmarking.md §4.1, §7).
# Usage: benchmarks/scripts/device-info.sh benchmarks/results/2026-10-xx_low-end-01
#
# Also records the display refresh rate (§4.2: pin it in display settings for the session):
# the setting (peak_refresh_rate) and the rate the display renders at right now. With
# EXPECTED_HZ set (e.g. EXPECTED_HZ=120), it fails unless the setting is exactly that rate.
# The rate inside the app can still be lower: on the vivo V2538 the ROM runs Pocketly at 60 Hz
# with the setting at 120. BM-02 records the in-app rate per iteration (bm-02-scroll.sh).
set -euo pipefail

OUT_DIR="${1:?usage: device-info.sh <results-dir>}"
mkdir -p "$OUT_DIR"

prop() { adb shell getprop "$1" | tr -d '\r'; }
mem_kb=$(adb shell cat /proc/meminfo | awk '/MemTotal/ {print $2}')
temp=$(adb shell dumpsys battery | awk -F': ' '/^ *temperature:/ {print $2}' | tr -d '\r')
level=$(adb shell dumpsys battery | awk -F': ' '/^ *level:/ {print $2}' | tr -d '\r')

# Display: the rate it renders at now, the modes it supports, and every refresh-related setting
# (key names differ between ROMs, so all of them are recorded as-is).
display=$(adb shell dumpsys display | tr -d '\r')
render_hz=$(grep -oE 'renderFrameRate [0-9.]+' <<<"$display" | head -1 | awk '{printf "%.0f", $2}')
modes_hz=$(grep -oE 'fps=[0-9.]+' <<<"$display" | awk -F= '{printf "%.0f\n", $2}' | sort -un | paste -sd, -)
refresh_settings=$(for ns in system secure global; do
  adb shell settings list "$ns" | tr -d '\r' | grep -iE 'refresh|_hz|frame_rate' | sed "s/^/$ns./"
done | awk -F= '{printf "%s\"%s\": \"%s\"", (NR > 1 ? ", " : ""), $1, $2}')
peak_hz=$(adb shell settings get system peak_refresh_rate | tr -d '\r' | awk '{printf "%.0f", $1}')
if [ -n "${EXPECTED_HZ:-}" ] && [ "${peak_hz:-}" != "$EXPECTED_HZ" ]; then
  echo "✗ refresh rate setting is ${peak_hz:-?} Hz, expected $EXPECTED_HZ Hz: pin it in display settings" >&2
  exit 1
fi

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
  "display": { "settingHz": ${peak_hz:-null}, "renderFrameRateHzAtCapture": ${render_hz:-null}, "supportedModesHz": [${modes_hz}], "expectedHz": ${EXPECTED_HZ:-null}, "refreshSettings": { ${refresh_settings} } },
  "temperatureLog": [{ "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "tenthsCelsius": ${temp:-null}, "batteryPct": ${level:-null} }]
}
JSON
echo "wrote $OUT_DIR/device.json"
