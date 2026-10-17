#!/usr/bin/env bash
# Fails if benchmark-only code reached a release build (benchmarking.md §5.2: it ships in perf
# builds only). Run after `assembleJsCoreRelease assembleKmpCoreRelease`; CI does.
#
#   benchmarks/scripts/check-release-clean.sh [buildType=release]
#
# For each flavor's APKs of that build type, checks:
#   - R8's mapping.txt: no KotlinCrypto, no com.pocketly.bench, no PocketlyBench Nitro classes,
#     and none of the core's bench-only paths (CoreProbe, TransactionIngestor) that R8 must
#     have removed as unreachable
#   - the APK: no libPocketlyCoreKmpBench.so
#   - the JS bundle (Hermes bytecode, searched as bytes: its string table packs strings back to
#     back, so `strings` can't split them): no @noble/hashes, no harness, no BenchCore
#
# `check-release-clean.sh perf` inverts it: every marker must be present in perf builds, which
# shows the checks can find what they look for.
set -euo pipefail

BUILD_TYPE="${1:-release}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/apps/mobile/android/app/build/outputs"
[ "$BUILD_TYPE" = release ] && EXPECT=absent || EXPECT=present

# label|where (mapping|lib|bundle)|regex|flavors it applies to
CHECKS=(
  "KotlinCrypto classes|mapping|^org\\.kotlincrypto\\.|kmpCore"
  "shared-bench classes|mapping|^com\\.pocketly\\.bench\\.|kmpCore"
  "PocketlyBench Nitro classes|mapping|^com\\.margelo\\.nitro\\.pocketly\\.bench\\.|kmpCore"
  "CoreProbe (incl. inlined frames)|mapping|com\\.pocketly\\.shared\\.bridge\\.CoreProbe|kmpCore"
  "TransactionIngestor (incl. inlined frames)|mapping|com\\.pocketly\\.shared\\.data\\.TransactionIngestor|kmpCore"
  "libPocketlyCoreKmpBench.so|lib|libPocketlyCoreKmpBench\\.so|kmpCore"
  "@noble/hashes|bundle|Hash should be wrapped by utils\\.createHasher|jsCore"
  "benchmark harness|bundle|bench-chunk|jsCore kmpCore"
  "BenchCore (staged ingest)|bundle|no ingest payload staged|jsCore"
  "PocketlyBench object|bundle|PocketlyBench|kmpCore"
  # Same contract index in both bundles; only jsCore's perf bench imports benchConstants.ts.
  "bench constants (core-contract/src/benchConstants.ts)|bundle|BM10_MAX_ITERATIONS|jsCore"
)

failures=0
for flavor in jsCore kmpCore; do
  apks=("$OUT/apk/$flavor/$BUILD_TYPE/"*.apk)
  [ -e "${apks[0]}" ] || { echo "✗ no $flavor $BUILD_TYPE APK in $OUT/apk/$flavor/$BUILD_TYPE" >&2; exit 1; }
  apk="${apks[0]}"
  mapping="$OUT/mapping/${flavor}$(tr '[:lower:]' '[:upper:]' <<<"${BUILD_TYPE:0:1}")${BUILD_TYPE:1}/mapping.txt"
  [ -f "$mapping" ] || { echo "✗ no R8 mapping for $flavor $BUILD_TYPE: $mapping" >&2; exit 1; }
  libs="$(unzip -Z1 "$apk" 'lib/*' 2>/dev/null || true)"
  bundle="$(mktemp)"
  unzip -p "$apk" assets/index.android.bundle >"$bundle"

  for check in "${CHECKS[@]}"; do
    IFS='|' read -r label where regex applies <<<"$check"
    [[ " $applies " == *" $flavor "* ]] || continue
    case "$where" in
      mapping) found=$(grep -cE "$regex" "$mapping" || true) ;;
      lib) found=$(grep -cE "$regex" <<<"$libs" || true) ;;
      bundle) found=$(LC_ALL=C grep -acE "$regex" "$bundle" || true) ;;
    esac
    if [ "$EXPECT" = absent ] && [ "$found" -gt 0 ]; then
      echo "✗ $flavor $BUILD_TYPE contains $label ($found × /$regex/ in $where)"
      failures=$((failures + 1))
    elif [ "$EXPECT" = present ] && [ "$found" -eq 0 ]; then
      echo "✗ $flavor $BUILD_TYPE lacks $label (/$regex/ in $where): the check can't see it"
      failures=$((failures + 1))
    else
      echo "✓ $flavor $BUILD_TYPE: $label $EXPECT"
    fi
  done
  rm -f "$bundle"
done

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed" >&2; exit 1; }
