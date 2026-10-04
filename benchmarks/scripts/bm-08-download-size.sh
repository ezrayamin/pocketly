#!/usr/bin/env bash
# BM-08 download size: what Play would ship to a device, per ABI (bundletool get-size total).
#
#   benchmarks/scripts/bm-08-download-size.sh <results-dir>
#
# Needs .tools/bundletool-all-*.jar (git-ignored; see benchmarks/README.md). Builds the
# release app bundles, generates APK sets, and writes the raw CSV per build to
# <results-dir>/bm-08-download/<build>.csv. apk-size.ts covers the APK-level breakdown.
set -euo pipefail

OUT_DIR="${1:?usage: bm-08-download-size.sh <results-dir>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLETOOL="$(ls "$ROOT"/.tools/bundletool-all-*.jar 2>/dev/null | tail -1)"
[ -n "$BUNDLETOOL" ] || { echo "bundletool jar not found in .tools/" >&2; exit 1; }
RAW="$OUT_DIR/bm-08-download"
mkdir -p "$RAW"

(cd "$ROOT/apps/mobile/android" && ./gradlew bundleJsCoreRelease bundleKmpCoreRelease --console=plain -q)

for build in jsCore kmpCore; do
  aab="$ROOT/apps/mobile/android/app/build/outputs/bundle/${build}Release/app-${build}-release.aab"
  apks="$(mktemp -d)/$build.apks"
  # Signing doesn't change sizes in any way that matters here; bundletool's default debug key is fine.
  java -jar "$BUNDLETOOL" build-apks --bundle="$aab" --output="$apks" --overwrite >/dev/null
  java -jar "$BUNDLETOOL" get-size total --apks="$apks" --dimensions=ABI > "$RAW/$build.csv"
  echo "$build:"; cat "$RAW/$build.csv"
done
echo "{ \"tool\": \"$(basename "$BUNDLETOOL")\", \"command\": \"get-size total --dimensions=ABI\", \"unit\": \"bytes\" }" > "$RAW/meta.json"
