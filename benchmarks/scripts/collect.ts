/**
 * Turns raw results into summary.csv + summary.md (benchmarking.md §4.3, §7).
 * Raw files are never edited; this script is the only producer of summaries.
 *
 *   npx tsx benchmarks/scripts/collect.ts <results-dir>
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Build = 'jsCore' | 'kmpCore';
const BUILDS: Build[] = ['jsCore', 'kmpCore'];

interface Stats {
  n: number;
  median: number;
  p90: number;
  p25: number;
  p75: number;
  iqr: number;
  mean: number;
  cv: number;
  min: number;
  max: number;
}

/** Linear-interpolated percentile (R type 7). */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(values: number[]): Stats {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1));
  const p25 = percentile(s, 0.25);
  const p75 = percentile(s, 0.75);
  return {
    n: s.length,
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    p25,
    p75,
    iqr: p75 - p25,
    mean,
    cv: sd / mean,
    min: s[0],
    max: s[s.length - 1],
  };
}

/** Two-sided Mann-Whitney U, normal approximation with tie correction. Returns p-value. */
function mannWhitney(a: number[], b: number[]): number {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    for (let k = i; k <= j; k++) ranks[k] = (i + j) / 2 + 1;
    i = j + 1;
  }
  const n1 = a.length;
  const n2 = b.length;
  const r1 = all.reduce((sum, x, i) => (x.g === 0 ? sum + ranks[i] : sum), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  const z = (Math.abs(u - mu) - 0.5) / sigma;
  return Math.min(1, 2 * (1 - normalCdf(z)));
}

function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf =
    1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

interface Row {
  scenario: string;
  metric: string;
  build: Build;
  unit: string;
  stats: Stats;
}

function collectStartup(dir: string, scenario: string, rows: Row[], verdicts: string[]) {
  const raw = join(dir, scenario.toLowerCase());
  if (!existsSync(join(raw, 'meta.json'))) return;
  const meta = JSON.parse(readFileSync(join(raw, 'meta.json'), 'utf8'));
  const values: Record<string, Record<Build, number[]>> = {};

  for (const file of readdirSync(raw).filter((f) => /^\d+-(jsCore|kmpCore)\.json$/.test(f)).sort()) {
    const [roundStr, buildWithExt] = file.split('-');
    const build = buildWithExt.replace('.json', '') as Build;
    if (Number(roundStr) <= meta.warmup) continue; // §4.3: warm-up runs discarded
    const data = JSON.parse(readFileSync(join(raw, file), 'utf8'));
    // Platform-log runner: one run per file. Macrobenchmark output: metrics.<name>.runs.
    const runs: Record<string, number[]> = data.benchmarks
      ? Object.fromEntries(Object.entries<{ runs: number[] }>(data.benchmarks[0].metrics).map(([k, m]) => [k, m.runs]))
      : { timeToInitialDisplayMs: [data.timeToInitialDisplayMs], timeToFullDisplayMs: [data.timeToFullDisplayMs] };
    for (const [metric, list] of Object.entries(runs)) {
      values[metric] ??= { jsCore: [], kmpCore: [] };
      values[metric][build].push(...list);
    }
  }

  for (const [metric, byBuild] of Object.entries(values)) {
    const s = { jsCore: stats(byBuild.jsCore), kmpCore: stats(byBuild.kmpCore) };
    for (const build of BUILDS) rows.push({ scenario, metric, build, unit: 'ms', stats: s[build] });

    const diff = (s.kmpCore.median - s.jsCore.median) / s.jsCore.median;
    const overlap = s.kmpCore.p25 <= s.jsCore.p75 && s.jsCore.p25 <= s.kmpCore.p75;
    const p = mannWhitney(byBuild.jsCore, byBuild.kmpCore);
    const noisy = BUILDS.filter((b) => s[b].cv > 0.1);
    const meaningful = Math.abs(diff) > 0.05 && !overlap;
    verdicts.push(
      `${scenario} ${metric}: kmpCore vs jsCore median ${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}%, ` +
        `IQRs ${overlap ? 'overlap' : "don't overlap"}, Mann-Whitney p=${p.toFixed(3)} → ` +
        `${meaningful ? 'MEANINGFUL difference' : 'no meaningful difference'} (rule: >5% and non-overlapping IQRs)` +
        (noisy.length ? ` · ⚠ CV > 10% for ${noisy.join(', ')}: rerun per §4.3` : ''),
    );
  }
}

function collectSize(dir: string, rows: Row[], verdicts: string[], extra: string[]) {
  const file = join(dir, 'bm-08-size.json');
  if (!existsSync(file)) return;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const one = (v: number): Stats => ({ n: 1, median: v, p90: v, p25: v, p75: v, iqr: 0, mean: v, cv: 0, min: v, max: v });

  type Apk = { build: Build; abi: string; fileBytes: number; groups: Record<string, number>; nativeLibs: Record<string, number>; jsBundleUncompressed: number };
  const apks: Apk[] = data.apks;
  for (const apk of apks) {
    rows.push({ scenario: 'BM-08', metric: `apkFile[${apk.abi}]`, build: apk.build, unit: 'bytes', stats: one(apk.fileBytes) });
  }
  for (const abi of [...new Set(apks.map((a) => a.abi))]) {
    const js = apks.find((a) => a.abi === abi && a.build === 'jsCore')!;
    const kmp = apks.find((a) => a.abi === abi && a.build === 'kmpCore')!;
    const d = kmp.fileBytes - js.fileBytes;
    verdicts.push(`BM-08 ${abi}: kmpCore ${kb(kmp.fileBytes)} vs jsCore ${kb(js.fileBytes)} → ${d >= 0 ? '+' : ''}${kb(d)} (${((d / js.fileBytes) * 100).toFixed(1)}%)`);
  }

  const js = apks.find((a) => a.abi === 'arm64-v8a' && a.build === 'jsCore')!;
  const kmp = apks.find((a) => a.abi === 'arm64-v8a' && a.build === 'kmpCore')!;
  extra.push('### BM-08 breakdown, arm64-v8a (compressed bytes in APK)', '', '| Part | jsCore | kmpCore | Δ |', '|---|---:|---:|---:|');
  for (const g of Object.keys(js.groups)) {
    extra.push(`| ${g} | ${kb(js.groups[g])} | ${kb(kmp.groups[g])} | ${delta(kmp.groups[g] - js.groups[g])} |`);
  }
  extra.push(`| JS bundle, uncompressed | ${kb(js.jsBundleUncompressed)} | ${kb(kmp.jsBundleUncompressed)} | ${delta(kmp.jsBundleUncompressed - js.jsBundleUncompressed)} |`);
  extra.push('', '| Native lib | jsCore | kmpCore |', '|---|---:|---:|');
  const libs = [...new Set([...Object.keys(js.nativeLibs), ...Object.keys(kmp.nativeLibs)])].sort(
    (a, b) => (kmp.nativeLibs[b] ?? 0) - (kmp.nativeLibs[a] ?? 0),
  );
  for (const lib of libs.filter((l) => /nitro|pocketly/i.test(l) || (js.nativeLibs[l] ?? 0) !== (kmp.nativeLibs[l] ?? 0))) {
    extra.push(`| ${lib} | ${js.nativeLibs[lib] ? kb(js.nativeLibs[lib]) : '—'} | ${kmp.nativeLibs[lib] ? kb(kmp.nativeLibs[lib]) : '—'} |`);
  }
  const kept = data.keptClassesByOrigin;
  if (kept?.kmpCore) {
    extra.push('', 'Classes kept by R8, by origin (from mapping.txt; counts, not bytes):', '', '| Origin | jsCore | kmpCore |', '|---|---:|---:|');
    for (const k of Object.keys(kept.kmpCore).sort()) extra.push(`| ${k} | ${kept.jsCore[k] ?? 0} | ${kept.kmpCore[k]} |`);
  }
}

const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const delta = (b: number) => (b === 0 ? '0' : `${b > 0 ? '+' : ''}${kb(b)}`);

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: collect.ts <results-dir>');
  const rows: Row[] = [];
  const verdicts: string[] = [];
  const extra: string[] = [];
  collectStartup(dir, 'BM-01', rows, verdicts);
  collectStartup(dir, 'BM-09', rows, verdicts);
  collectSize(dir, rows, verdicts, extra);

  const header = 'scenario,metric,build,unit,n,median,p90,p25,p75,iqr,mean,cv,min,max';
  const csv = rows.map((r) => {
    const s = r.stats;
    return [r.scenario, r.metric, r.build, r.unit, s.n, s.median, s.p90, s.p25, s.p75, s.iqr, s.mean, s.cv, s.min, s.max]
      .map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : v))
      .join(',');
  });
  writeFileSync(join(dir, 'summary.csv'), [header, ...csv].join('\n') + '\n');

  const md = ['# Summary', '', `_Generated by benchmarks/scripts/collect.ts from raw files in this folder._`, ''];
  const timed = rows.filter((r) => r.unit === 'ms');
  if (timed.length) {
    md.push('| Scenario | Metric | Build | n | Median | p90 | IQR (p25–p75) | CV |', '|---|---|---|---:|---:|---:|---|---:|');
    for (const r of timed) {
      const s = r.stats;
      md.push(`| ${r.scenario} | ${r.metric} | ${r.build} | ${s.n} | ${s.median.toFixed(1)} ms | ${s.p90.toFixed(1)} ms | ${s.iqr.toFixed(1)} (${s.p25.toFixed(1)}–${s.p75.toFixed(1)}) | ${(s.cv * 100).toFixed(1)}% |`);
    }
    md.push('');
  }
  md.push('## Verdicts', '', ...verdicts.map((v) => `- ${v}`), '', ...extra, '');
  writeFileSync(join(dir, 'summary.md'), md.join('\n'));
  console.log(md.join('\n'));
}

main();
