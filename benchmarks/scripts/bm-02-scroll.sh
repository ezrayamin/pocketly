#!/usr/bin/env bash
# BM-02 (control, H4): "scroll History through 1,000 transactions, top → bottom ×3",
# driven with plain adb input. bm-02-run.sh runs it under Flashlight as three steps so that
# only the scrolling is measured:
#
#   bm-02-scroll.sh <package> prepare   cold start with launch arguments, wait for the list
#                                        (Flashlight --beforeEachCommand, not measured)
#   bm-02-scroll.sh <package> scroll    3 passes × SWIPES swipes, History tab tap between passes
#                                        (Flashlight --testCommand: the measured part)
#   bm-02-scroll.sh <package> verify    fails unless the last pass reached the end of the list
#                                        (Flashlight --afterEachCommand, not measured)
#   bm-02-scroll.sh <package> [all]     all three, for a manual check
#
# Why not Maestro (benchmarks/maestro/bm-02-scroll.yaml): on the vivo V2538 its driver's
# view-hierarchy call hangs for minutes or fails, while `uiautomator dump` takes ~3 s.
# Same pattern as BM-01 moving off Macrobenchmark (docs/benchmarking.md §5 note).
#
# - Needs a perf build (launch arguments, docs/benchmarking.md §5.3).
# - Every iteration makes the same gestures: a fixed number of swipes per pass, no screen
#   reads while scrolling. Pass 1 also pages the list in (20 per page) and needs ~80 swipes
#   on the V2538, hence 96. Env: SWIPES (default 96), PASSES (default 3).
set -euo pipefail

PKG="${1:?usage: bm-02-scroll.sh <package> [prepare|scroll|verify|all]}"
STEP="${2:-all}"
SWIPES="${SWIPES:-96}"
PASSES="${PASSES:-3}"
ACTIVITY="com.pocketly.MainActivity"

# Input coordinates are in the (possibly overridden) display size.
size=$(adb shell wm size | tr -d '\r' | awk -F': ' '/Override size/ {o=$2} /Physical size/ {p=$2} END {print (o != "" ? o : p)}')
W=${size%x*}
H=${size#*x}
X=$((W / 2))
FROM_Y=$((H * 80 / 100))
TO_Y=$((H * 17 / 100))
# History tab, in the custom tab bar (src/components/TabBar.tsx): tapping it again scrolls to the top.
TAB_X=$((W * 384 / 1000))
TAB_Y=$((H * 946 / 1000))

has_id() { # <resource-id> → exit 0 if on screen
  adb shell uiautomator dump /sdcard/bm02.xml >/dev/null 2>&1 || return 1
  adb shell cat /sdcard/bm02.xml | grep -q "resource-id=\"$1\""
}

prepare() {
  adb shell am force-stop "$PKG"
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell am start -W -n "$PKG/$ACTIVITY" \
    -e pocketly.tab history --ei pocketly.transactionCount 1000 >/dev/null
  for _ in $(seq 1 30); do
    has_id history-list && return 0
    sleep 1
  done
  echo "✗ $PKG: History never appeared" >&2
  exit 1
}

scroll() {
  for pass in $(seq 1 "$PASSES"); do
    for _ in $(seq 1 "$SWIPES"); do
      adb shell input swipe "$X" "$FROM_Y" "$X" "$TO_Y" 120
    done
    # Back to the top for the next pass; the last pass stays at the end for `verify`.
    if [ "$pass" -lt "$PASSES" ]; then
      adb shell input tap "$TAB_X" "$TAB_Y"
      sleep 1
    fi
  done
}

verify() {
  has_id history-end || { echo "✗ $PKG: the last pass didn't reach the end after $SWIPES swipes" >&2; exit 1; }
  echo "✓ $PKG: $PASSES passes × $SWIPES swipes, end reached"
}

case "$STEP" in
  prepare) prepare ;;
  scroll) scroll ;;
  verify) verify ;;
  all) prepare; scroll; verify ;;
  *) echo "step must be prepare|scroll|verify|all" >&2; exit 1 ;;
esac
