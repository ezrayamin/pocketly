#!/usr/bin/env bash
# BM-07: the full transfer flow, Home → Send → Andi → $150 → review → PIN → result, with the
# fake backend's latency fixed at 300 ms (docs/benchmarking.md §6), driven with plain adb
# input. bm-07-run.sh runs it under Flashlight as three steps:
#
#   bm-07-flow.sh <package> prepare   cold start with launch arguments (dataset reset, 300 ms
#                                     latency), unlock with the in-app PIN as a user does, wait
#                                     for Home
#                                     (Flashlight --beforeEachCommand, not measured)
#   bm-07-flow.sh <package> run       the flow (Flashlight --testCommand: the measured part)
#   bm-07-flow.sh <package> verify    fails unless the result is Sent; saves the app's step marks
#                                     (Flashlight --afterEachCommand, not measured)
#   bm-07-flow.sh <package> calibrate one flow with screen dumps, to find every control
#   bm-07-flow.sh <package> [all]     prepare, run, verify
#
# Why not Maestro (benchmarks/maestro/bm-07-transfer.yaml): on the vivo V2538 its driver dies
# on the first tap (2026-10-17), as in BM-02. During `run` the driver never reads the phone: taps
# go to coordinates found by `calibrate`, STEP_S apart (CONFIRM_S after the PIN), so every
# iteration makes the same gestures at the same times. The app timestamps each step itself
# (perf bundles only: apps/mobile/src/bench/flowMarks.tsx) and the result screen shows the
# marks in a hidden element that `verify` reads. Not logcat: this ROM rate-limits app logging
# (persist.log.ratelimit=1) and dropped the marks.
#
# - Needs a perf build (launch arguments, §5.3) onboarded with Pocketly's in-app test PIN
#   (env PIN; never the phone's own), biometrics off, so Confirm goes straight to the PIN.
# - Env: PIN (required), COORDS (default /tmp/bm-07-<package>.coords),
# - Every launch resets the fake server's dataset, so the balance, today's limit and the
#   transfer id (trf-1) are the same in every iteration.
#   MARKS_DIR (verify appends each iteration's marks there as <n>.txt), STEP_S (default 1.5),
#   CONFIRM_S (default 4: PIN hashing, 300 ms submit, result). A failed verify saves the
#   screen under MARKS_DIR/failures/.
set -euo pipefail

PKG="${1:?usage: bm-07-flow.sh <package> [prepare|run|verify|calibrate|all]}"
STEP="${2:-all}"
STEP_S="${STEP_S:-1.5}"
CONFIRM_S="${CONFIRM_S:-4}"
COORDS="${COORDS:-${TMPDIR:-/tmp}/bm-07-$PKG.coords}"
ACTIVITY="com.pocketly.MainActivity"
AMOUNT=150

launch() {
  adb shell am force-stop "$PKG"
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell am start -W -n "$PKG/$ACTIVITY" \
    --ei pocketly.seed 42 --ei pocketly.transactionCount 200 \
    -e pocketly.network.mode NORMAL -e pocketly.network.failureRatePercent 0 \
    -e pocketly.network.normalLatencyMs 300 >/dev/null
}

dump() { # → the screen's XML on stdout
  adb shell uiautomator dump /sdcard/bm07.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/bm07.xml
}

center() { # <resource-id> → "x y" from the current screen, or nothing
  dump | python3 -c '
import re, sys
xml, rid = sys.stdin.read(), sys.argv[1]
m = re.search(r"resource-id=\"%s\"[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"" % re.escape(rid), xml)
if m: print((int(m[1]) + int(m[3])) // 2, (int(m[2]) + int(m[4])) // 2)' "$1"
}

wait_id() { # <resource-id> [tries]
  for _ in $(seq 1 "${2:-30}"); do
    [ -n "$(center "$1")" ] && return 0
    sleep 0.5
  done
  echo "✗ $PKG: $1 never appeared" >&2
  exit 1
}

tap_id() { # <resource-id>: calibration only (reads the screen)
  wait_id "$1"
  local xy
  xy=$(center "$1")
  echo "$1 $xy" >>"$COORDS"
  adb shell input tap $xy
}

tap() { # <resource-id>: from the calibrated coordinates
  local xy
  xy=$(awk -v id="$1" '$1 == id {print $2, $3; exit}' "$COORDS")
  [ -n "$xy" ] || { echo "✗ $PKG: no coordinates for $1 (run calibrate)" >&2; exit 1; }
  adb shell input tap $xy
}

evidence() { # <why>: what the phone showed when an iteration failed
  local dir="${MARKS_DIR:-${TMPDIR:-/tmp}}/failures/$(date +%H%M%S)"
  mkdir -p "$dir"
  echo "$1" >"$dir/why.txt"
  dump >"$dir/screen.xml"
  adb exec-out screencap -p >"$dir/screen.png"
  echo "  evidence in $dir" >&2
}

unlock() { # the lock screen (FR-LOCK-01), like every real session; its keys from calibrate
  : "${PIN:?PIN (the in-app test PIN) is required}"
  wait_id pin-key-1 40
  for d in $(echo "$PIN" | grep -o .); do tap "lock-key-$d"; sleep 0.15; done
}

prepare() {
  launch
  unlock
  wait_id balance 40
  sleep 1 # Home's first render settles; a tap right after it was sometimes lost
}

calibrate() {
  : "${PIN:?PIN (the in-app test PIN) is required}"
  rm -f "$COORDS"
  launch
  wait_id pin-key-1 40
  for d in $(echo "$PIN" | grep -o . | sort -u); do echo "lock-key-$d $(center "pin-key-$d")" >>"$COORDS"; done
  for d in $(echo "$PIN" | grep -o .); do tap "lock-key-$d"; sleep 0.15; done
  wait_id balance 40
  sleep 1
  tap_id quick-send
  tap_id contact-u-01
  for d in $(echo "$AMOUNT" | grep -o .); do tap_id "amount-key-$d"; done
  tap_id amount-review
  tap_id review-confirm
  for d in $(echo "$PIN" | grep -o . | sort -u); do
    wait_id "pin-key-$d"
    echo "pin-key-$d $(center "pin-key-$d")" >>"$COORDS"
  done
  for d in $(echo "$PIN" | grep -o .); do tap "pin-key-$d"; sleep 0.15; done
  wait_id send-result-success 60
  echo "result-done $(center result-done)" >>"$COORDS"
  echo "✓ $PKG: calibrated $(wc -l <"$COORDS" | tr -d ' ') controls → $COORDS"
}

run() {
  : "${PIN:?PIN (the in-app test PIN) is required}"
  tap quick-send
  sleep "$STEP_S"
  tap contact-u-01
  sleep "$STEP_S"
  for d in $(echo "$AMOUNT" | grep -o .); do tap "amount-key-$d"; sleep 0.15; done
  tap amount-review
  sleep "$STEP_S"
  tap review-confirm
  sleep "$STEP_S"
  for d in $(echo "$PIN" | grep -o .); do tap "pin-key-$d"; sleep 0.15; done
  sleep "$CONFIRM_S"
}

verify() {
  local xml marks
  xml=$(dump)
  marks=$(python3 -c '
import re, sys
m = re.search(r"content-desc=\"flow-marks ([^\"]*)\"", sys.stdin.read())
print("\n".join("flow-mark %s %s" % tuple(p.split("=")) for p in m[1].split(";") if "=" in p) if m else "")' <<<"$xml")
  if ! grep -q 'resource-id="send-result-success"' <<<"$xml" || ! grep -q 'flow-mark result-shown-SUCCESS ' <<<"$marks"; then
    echo "✗ $PKG: no successful result with its marks" >&2
    evidence "no successful result"
    exit 1
  fi
  if [ -n "${MARKS_DIR:-}" ]; then
    mkdir -p "$MARKS_DIR"
    n=$(find "$MARKS_DIR" -maxdepth 1 -name '[0-9]*.txt' | wc -l | tr -d ' ')
    echo "$marks" >"$MARKS_DIR/$(printf '%02d' $((n + 1))).txt"
  fi
  echo "✓ $PKG: Sent ($(wc -l <<<"$marks" | tr -d ' ') marks)"
}

case "$STEP" in
  prepare) prepare ;;
  run) run ;;
  verify) verify ;;
  calibrate) calibrate ;;
  all) prepare; run; verify ;;
  *) echo "step must be prepare|run|verify|calibrate|all" >&2; exit 1 ;;
esac
