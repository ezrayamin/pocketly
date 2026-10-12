#!/usr/bin/env bash
# ADR-0007 on-device check: a response that arrives after its own timeout changes nothing,
# neither on screen nor in the replica. Uses the dev links (ADR-0008), so any build with dev
# tools works. Usage: apps/mobile/scripts/late-response-check.sh com.pocketly.js|com.pocketly.kmp
#
# 1 cold start · 2 network 6 s latency / 2 s timeout · 3 server-side incoming transfer: the
# reload times out and shows the replica · 4 the late response (new balance + transaction)
# arrives at ~6 s and must change nothing · 5 OFFLINE: the replica still lacks the transfer ·
# 6 NORMAL: the transfer appears (the server had it all along).
set -uo pipefail
PKG=$1
# Quoted for the device shell: an unquoted & would background the command and cut the URL.
link() { adb shell "am start -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null 2>&1; }
screen() { adb shell uiautomator dump /sdcard/late.xml >/dev/null 2>&1; adb shell cat /sdcard/late.xml; }
show() { # label, xml
  local xml=$2
  local bal banner sim
  bal=$(grep -oE '<node [^>]*resource-id="balance"[^>]*>' <<<"$xml" | grep -oE ' text="[^"]*"' | head -1)
  [ -z "$bal" ] && bal=$(grep -oE 'text="\$[0-9,]+\.[0-9]{2}"' <<<"$xml" | head -1)
  banner=$(grep -oE "text=\"(You're offline|This is taking longer|Something went wrong)[^\"]*\"" <<<"$xml" | head -1)
  sim=$(grep -oE 'resource-id="tx-sim-[0-9]+"' <<<"$xml" | sort -u | grep -oE 'sim-[0-9]+' | paste -sd, -)
  echo "  $1: balance ${bal:-?} | banner ${banner:-none} | simulated rows on Home: ${sim:-none}"
}

adb shell am force-stop "$PKG"; adb logcat -c
adb shell am start -W -n "$PKG/com.pocketly.MainActivity" >/dev/null; sleep 5
show "1 start (NORMAL)" "$(screen)"

link "pocketly://dev/network?mode=NORMAL&failureRatePercent=0&normalLatencyMs=6000&readTimeoutMs=2000"
sleep 9 # this reload times out at 2 s; its late response (unchanged data) lands at ~6 s
show "2 slow network set, after its reload" "$(screen)"

link "pocketly://dev/incoming" # server-side change; the app reloads at once
sleep 3
show "3 incoming added, reload timed out (t+3s)" "$(screen)"
sleep 8 # the late response with the new balance and transaction lands at ~t+6s
show "4 after the late response (t+11s)" "$(screen)"

link "pocketly://dev/network?mode=OFFLINE"
sleep 4
show "5 OFFLINE: replica only" "$(screen)"

link "pocketly://dev/network?mode=NORMAL&normalLatencyMs=0&readTimeoutMs=10000"
sleep 4
show "6 NORMAL again: fresh from server" "$(screen)"
adb logcat -d | grep -E "ReactNativeJS.*\[Pocketly\] dev link|FATAL|AndroidRuntime: Process" | sed -E 's/^.*ReactNativeJS: /  log: /' | cut -c1-140
