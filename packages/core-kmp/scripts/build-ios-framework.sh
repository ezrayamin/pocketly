#!/usr/bin/env bash
# Builds the KMP XCFramework and drops it where PocketlyCoreKmp.podspec expects it.
#   CONFIGURATION=Debug|Release (default: Release)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SHARED="$HERE/../../shared"
CONFIGURATION="${CONFIGURATION:-Release}"

(cd "$SHARED" && ./gradlew "assemblePocketlyShared${CONFIGURATION}XCFramework" --console=plain)

LOWER="$(echo "$CONFIGURATION" | tr '[:upper:]' '[:lower:]')"
mkdir -p "$HERE/ios/Frameworks"
rm -rf "$HERE/ios/Frameworks/PocketlyShared.xcframework"
cp -R "$SHARED/build/XCFrameworks/$LOWER/PocketlyShared.xcframework" "$HERE/ios/Frameworks/"
echo "PocketlyShared.xcframework ($CONFIGURATION) → ios/Frameworks/"
