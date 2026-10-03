/**
 * BM-08: per-ABI APK size with a breakdown of where the bytes are.
 *
 *   npx tsx benchmarks/scripts/apk-size.ts <results-dir>
 *
 * Reads the split release APKs (build with -PsplitApksByAbi) and writes
 * <results-dir>/bm-08-size.json. Sizes are COMPRESSED bytes inside the APK, i.e. what
 * APK Analyzer calls "download size" before Play's extra compression. bundletool's
 * `get-size total` would be closer to the real download; it needs bundletool installed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const APK_DIR = join(ROOT, 'apps/mobile/android/app/build/outputs/apk');
const MAPPING_DIR = join(ROOT, 'apps/mobile/android/app/build/outputs/mapping');
const BUILDS = ['jsCore', 'kmpCore'] as const;
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'] as const;

interface Entry {
  name: string;
  size: number;
  compressed: number;
}

function zipEntries(apk: string): Entry[] {
  // zipinfo -l: perms ver os SIZE flags COMPRESSED method date time NAME
  return execFileSync('zipinfo', ['-l', apk], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 10 && /^[-d]/.test(cols[0]))
    .map((cols) => ({ size: Number(cols[3]), compressed: Number(cols[5]), name: cols.slice(9).join(' ') }));
}

function breakdown(entries: Entry[]) {
  const groups: Record<string, number> = { nativeLibs: 0, dex: 0, jsBundle: 0, resources: 0, other: 0 };
  const nativeLibs: Record<string, number> = {};
  for (const e of entries) {
    if (e.name.startsWith('lib/')) {
      groups.nativeLibs += e.compressed;
      const lib = e.name.split('/').pop()!;
      nativeLibs[lib] = (nativeLibs[lib] ?? 0) + e.compressed;
    } else if (/^classes\d*\.dex$/.test(e.name)) {
      groups.dex += e.compressed;
    } else if (e.name === 'assets/index.android.bundle') {
      groups.jsBundle += e.compressed;
    } else if (e.name.startsWith('res/') || e.name === 'resources.arsc') {
      groups.resources += e.compressed;
    } else {
      groups.other += e.compressed;
    }
  }
  const jsBundleUncompressed = entries.find((e) => e.name === 'assets/index.android.bundle')?.size ?? 0;
  return { groups, nativeLibs, jsBundleUncompressed };
}

/** Classes R8 kept, grouped by original package root (from mapping.txt). Attribution only. */
function keptClassesByOrigin(build: string): Record<string, number> {
  const mapping = join(MAPPING_DIR, `${build}Release/mapping.txt`);
  if (!existsSync(mapping)) {
    return {};
  }
  const buckets: [string, RegExp][] = [
    ['pocketly-shared (KMP core)', /^com\.pocketly\.shared\./],
    ['core-kmp Nitro adapter', /^com\.margelo\.nitro\.pocketly\./],
    ['nitro runtime', /^com\.margelo\.nitro\./],
    ['kotlinx.coroutines', /^kotlinx\.coroutines\./],
    ['kotlinx.serialization', /^kotlinx\.serialization\./],
    ['koin', /^org\.koin\./],
    ['kotlin stdlib', /^kotlin\./],
    ['react-native', /^com\.facebook\./],
  ];
  const counts: Record<string, number> = {};
  for (const line of readFileSync(mapping, 'utf8').split('\n')) {
    if (line.startsWith(' ') || line.startsWith('#') || !line.includes(' -> ')) {
      continue;
    }
    const original = line.split(' -> ')[0];
    const bucket = buckets.find(([, re]) => re.test(original))?.[0] ?? 'other';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    throw new Error('usage: apk-size.ts <results-dir>');
  }
  const apks = [];
  for (const build of BUILDS) {
    for (const abi of ABIS) {
      const apk = join(APK_DIR, `${build}/release/app-${build}-${abi}-release.apk`);
      if (!existsSync(apk)) {
        throw new Error(`missing ${apk} — build with: ./gradlew assemble${build[0].toUpperCase()}${build.slice(1)}Release -PsplitApksByAbi`);
      }
      const entries = zipEntries(apk);
      apks.push({
        build,
        abi,
        fileBytes: statSync(apk).size,
        ...breakdown(entries),
      });
    }
  }
  const result = {
    scenario: 'BM-08',
    measuredAt: new Date().toISOString(),
    unit: 'bytes',
    note: 'groups/nativeLibs are compressed sizes inside the APK; fileBytes is the APK file size',
    apks,
    keptClassesByOrigin: Object.fromEntries(BUILDS.map((b) => [b, keptClassesByOrigin(b)])),
  };
  const out = join(outDir, 'bm-08-size.json');
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(`wrote ${out}`);
}

main();
