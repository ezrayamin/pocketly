#!/usr/bin/env bash
# What a PIN unlock leaves in memory (follow-up to BM-07's +28 MB, sessions 2026-10-17_mid-04/05),
# and whether Android can take it back. Per build and round, `dumpsys meminfo` in four states:
#
#   A  no-unlock    cold start with pocketly.skipLock=true, Home, settle
#   B  unlocked     cold start, unlock on the lock screen with the in-app PIN, Home, settle
#   C  trimmed      after B: am send-trim-memory <pkg> RUNNING_CRITICAL, wait
#   D  background   after C: Home key (app in the background), wait
#
#   PIN=<in-app test PIN> benchmarks/scripts/unlock-memory.sh <results-dir> [rounds=3]
#
# Both cold starts pass the same dataset and network launch arguments as BM-07 (dataset reset,
# latency 300 ms), so the unlock is the only difference between A and B. Builds alternate within
# each round. Lock-screen key positions come from a BM-07 calibration (COORDS_JS / COORDS_KMP,
# default: session 2026-10-17_mid-05). Raw output: <results-dir>/unlock-memory/<round>-<build>-<state>.txt,
# summary: unlock-memory/summary.csv (PSS and RSS per category, KB). Perf builds only.
set -euo pipefail

OUT_DIR="${1:?usage: PIN=… unlock-memory.sh <results-dir> [rounds]}"
ROUNDS="${2:-3}"
: "${PIN:?PIN (the in-app test PIN) is required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CAL="$HERE/../results/2026-10-17_mid-05/bm-07"
COORDS_JS="${COORDS_JS:-$CAL/coords-jsCore.txt}"
COORDS_KMP="${COORDS_KMP:-$CAL/coords-kmpCore.txt}"
SETTLE_S="${SETTLE_S:-5}"
RAW="$OUT_DIR/unlock-memory"
ACTIVITY="com.pocketly.MainActivity"
mkdir -p "$RAW"

has_id() { adb shell uiautomator dump /sdcard/um.xml >/dev/null 2>&1 || return 1; adb shell cat /sdcard/um.xml | grep -q "resource-id=\"$1\""; }
wait_id() { for _ in $(seq 1 40); do has_id "$1" && return 0; sleep 0.5; done; echo "✗ $1 never appeared" >&2; exit 1; }

start() { # <pkg> [extra am args…]
  local pkg=$1; shift
  adb shell am force-stop "$pkg"
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell am start -W -n "$pkg/$ACTIVITY" "$@" \
    --ei pocketly.seed 42 --ei pocketly.transactionCount 200 \
    -e pocketly.network.mode NORMAL -e pocketly.network.failureRatePercent 0 \
    -e pocketly.network.normalLatencyMs 300 >/dev/null
}

snap() { # <pkg> <file>
  adb shell dumpsys meminfo "$1" | tr -d '\r' >"$2"
  grep -q 'TOTAL PSS' "$2" || { echo "✗ no meminfo for $1" >&2; exit 1; }
}

for round in $(seq 1 "$ROUNDS"); do
  for build in jsCore kmpCore; do
    if [ "$build" = jsCore ]; then pkg=com.pocketly.js coords=$COORDS_JS; else pkg=com.pocketly.kmp coords=$COORDS_KMP; fi
    tag="$(printf '%02d' "$round")-$build"
    echo "▸ round $round $build"

    start "$pkg" -e pocketly.skipLock true
    wait_id balance
    sleep "$SETTLE_S"
    snap "$pkg" "$RAW/$tag-A-no-unlock.txt"

    start "$pkg"
    wait_id pin-key-1
    for d in $(echo "$PIN" | grep -o .); do
      adb shell input tap $(awk -v id="lock-key-$d" '$1 == id {print $2, $3; exit}' "$coords")
      sleep 0.15
    done
    wait_id balance
    sleep "$SETTLE_S"
    snap "$pkg" "$RAW/$tag-B-unlocked.txt"

    adb shell am send-trim-memory "$pkg" RUNNING_CRITICAL
    sleep "$SETTLE_S"
    snap "$pkg" "$RAW/$tag-C-trimmed.txt"

    adb shell input keyevent KEYCODE_HOME
    sleep 10
    snap "$pkg" "$RAW/$tag-D-background.txt"
  done
done

# One row per snapshot: the App Summary's PSS and RSS columns.
python3 - "$RAW" <<'PY'
import csv, glob, os, re, sys
raw = sys.argv[1]
rows = []
for path in sorted(glob.glob(os.path.join(raw, '*-*-*.txt'))):
    round_, build, state = re.match(r'(\d+)-(jsCore|kmpCore)-(.+)\.txt$', os.path.basename(path)).groups()
    text = open(path).read()
    summary = text[text.index('App Summary'):] if 'App Summary' in text else ''
    row = {'round': int(round_), 'build': build, 'state': state}
    for label in ['Java Heap', 'Native Heap', 'Code', 'Stack', 'Graphics', 'Private Other', 'System']:
        m = re.search(r'%s:\s+(\d+)(?:\s+(\d+))?' % re.escape(label), summary)
        row[label.replace(' ', '') + 'Pss'] = int(m[1]) if m else ''
        row[label.replace(' ', '') + 'Rss'] = int(m[2]) if m and m[2] else ''
    for key, label in [('totalPss', 'TOTAL PSS'), ('totalRss', 'TOTAL RSS')]:
        m = re.search(r'%s:\s+(\d+)' % label, summary)
        row[key] = int(m[1]) if m else ''
    rows.append(row)
with open(os.path.join(raw, 'summary.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(f'{len(rows)} snapshots → {raw}/summary.csv')
PY
cat > "$RAW/meta.json" <<JSON
{ "check": "unlock memory (BM-07 follow-up)", "rounds": $ROUNDS, "settleS": $SETTLE_S,
  "states": ["A no-unlock (skipLock)", "B unlocked (lock-screen PIN)", "C after send-trim-memory RUNNING_CRITICAL", "D 10 s in the background"],
  "tool": "adb shell dumpsys meminfo", "build": "perf", "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
