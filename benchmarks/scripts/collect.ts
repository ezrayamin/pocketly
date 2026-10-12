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

/**
 * Hodges–Lehmann shift (median of all pairwise b − a differences) with its distribution-free
 * 95% CI (Moses, normal approximation). It is the estimate that matches the Mann-Whitney test:
 * the CI excludes 0 exactly when that test is significant at 5% (up to the approximation).
 */
function hodgesLehmann(a: number[], b: number[]): { shift: number; low: number; high: number } {
  const diffs: number[] = [];
  for (const x of a) for (const y of b) diffs.push(y - x);
  diffs.sort((p, q) => p - q);
  const n = diffs.length;
  const k = Math.max(0, Math.floor(n / 2 - 1.96 * Math.sqrt((a.length * b.length * (a.length + b.length + 1)) / 12)));
  return { shift: percentile(diffs, 0.5), low: diffs[k], high: diffs[n - 1 - k] };
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

interface Comparison {
  scenario: string;
  metric: string;
  unit: string;
  diffPct: number;
  shift: number;
  low: number;
  high: number;
  p: number;
  meaningful: boolean;
}
const comparisons: Comparison[] = [];

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

  for (const [metric, byBuild] of Object.entries(values)) compare(scenario, metric, 'ms', byBuild, rows, verdicts);
}

/** Stats per build, kmpCore − jsCore shift, and the §4.3 verdict (>5% and non-overlapping IQRs). */
function compare(scenario: string, metric: string, unit: string, byBuild: Record<Build, number[]>, rows: Row[], verdicts: string[]) {
  const s = { jsCore: stats(byBuild.jsCore), kmpCore: stats(byBuild.kmpCore) };
  for (const build of BUILDS) rows.push({ scenario, metric, build, unit, stats: s[build] });

  const diff = (s.kmpCore.median - s.jsCore.median) / s.jsCore.median;
  const overlap = s.kmpCore.p25 <= s.jsCore.p75 && s.jsCore.p25 <= s.kmpCore.p75;
  const p = mannWhitney(byBuild.jsCore, byBuild.kmpCore);
  const hl = hodgesLehmann(byBuild.jsCore, byBuild.kmpCore);
  // §4.3: for timings, the CV rule applies only above a 2 ms median (timer precision); rates
  // under 5% (janky frames) are judged in percentage points, not by CV.
  const noisy = BUILDS.filter(
    (b) => s[b].cv > 0.1 && (unit !== 'ms' || s[b].median > 2) && (unit !== '%' || s[b].median >= 5),
  );
  const meaningful = Math.abs(diff) > 0.05 && !overlap;
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  comparisons.push({ scenario, metric, unit, diffPct: diff * 100, shift: hl.shift, low: hl.low, high: hl.high, p, meaningful });
  verdicts.push(
    `${scenario} ${metric}: kmpCore vs jsCore median ${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}%, ` +
      `shift ${signed(hl.shift)} ${unit} (95% CI ${signed(hl.low)} to ${signed(hl.high)} ${unit}), ` +
      `IQRs ${overlap ? 'overlap' : "don't overlap"}, Mann-Whitney p=${p.toFixed(3)} → ` +
      `${meaningful ? 'MEANINGFUL difference' : 'no meaningful difference'} (rule: >5% and non-overlapping IQRs)` +
      (noisy.length ? ` · ⚠ CV > 10% for ${noisy.join(', ')}: rerun per §4.3` : ''),
  );
}

/**
 * Flashlight runs (BM-02; later BM-05, BM-07): <scenario>/<block>-<build>.json, one value per
 * successful iteration. Each measure is a ~500 ms sample: fps (UI frames), cpu.perName (% per
 * thread, 100% = one core), ram (MB). mqt_v_js is React Native's JS thread.
 */
const FLASHLIGHT_METRICS: { metric: string; unit: string; of: (m: FlashlightMeasure[]) => number }[] = [
  { metric: 'fps', unit: 'fps', of: (m) => mean(m.map((x) => x.fps)) },
  { metric: 'cpuTotal', unit: '%', of: (m) => mean(m.map((x) => sum(Object.values(x.cpu.perName)))) },
  { metric: 'cpuJsThread', unit: '%', of: (m) => mean(m.map((x) => x.cpu.perName.mqt_v_js ?? 0)) },
  { metric: 'cpuUiThread', unit: '%', of: (m) => mean(m.map((x) => x.cpu.perName['UI Thread'] ?? 0)) },
  { metric: 'cpuRenderThread', unit: '%', of: (m) => mean(m.map((x) => x.cpu.perName.RenderThread ?? 0)) },
  { metric: 'ramMax', unit: 'MB', of: (m) => Math.max(...m.map((x) => x.ram)) },
];
type FlashlightMeasure = { fps: number; ram: number; cpu: { perName: Record<string, number> } };
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const mean = (v: number[]) => sum(v) / v.length;

function collectFlashlight(dir: string, scenario: string, rows: Row[], verdicts: string[]) {
  const raw = join(dir, scenario.toLowerCase());
  if (!existsSync(join(raw, 'meta.json'))) return;
  const values: Record<string, Record<Build, number[]>> = {};
  let failed = 0;
  for (const file of readdirSync(raw).filter((f) => /^\d+-(jsCore|kmpCore)\.json$/.test(f)).sort()) {
    const build = file.split('-')[1].replace('.json', '') as Build;
    const data = JSON.parse(readFileSync(join(raw, file), 'utf8'));
    for (const it of data.iterations as { status: string; measures: FlashlightMeasure[] }[]) {
      if (it.status !== 'SUCCESS' || it.measures.length === 0) {
        failed++;
        continue;
      }
      for (const { metric, of } of FLASHLIGHT_METRICS) {
        values[metric] ??= { jsCore: [], kmpCore: [] };
        values[metric][build].push(of(it.measures));
      }
    }
  }
  for (const { metric, unit } of FLASHLIGHT_METRICS) {
    if (values[metric]) compare(scenario, metric, unit, values[metric], rows, verdicts);
  }
  if (failed) verdicts.push(`${scenario}: ${failed} iteration(s) not SUCCESS, excluded`);
  collectGfxinfo(raw, scenario, rows, verdicts);
  collectTemperatures(raw, scenario, verdicts);
}

/**
 * In-app harness (BM-03, BM-04, BM-06, BM-11): <scenario>/<round>-<build>.json, each holding the
 * measured runs of one cold start. Adds the bridge overhead per run: end-to-end − compute −
 * storage (BM-03/04), batch end-to-end − batch compute (BM-06). Checks that both builds
 * saw the same input and produced the same output (checksums).
 */
type HarnessResult = {
  build: string;
  runs: Record<string, number>[];
  input: { checksum: string };
  output: { checksum: string };
};

function collectHarness(dir: string, scenario: string, rows: Row[], verdicts: string[]) {
  const raw = join(dir, scenario.toLowerCase());
  if (!existsSync(join(raw, 'meta.json'))) return;
  const values: Record<string, Record<Build, number[]>> = {};
  const sums: Record<Build, Set<string>> = { jsCore: new Set(), kmpCore: new Set() };
  for (const file of readdirSync(raw).filter((f) => /^\d+-(jsCore|kmpCore)\.json$/.test(f)).sort()) {
    const build = file.split('-')[1].replace('.json', '') as Build;
    const result = JSON.parse(readFileSync(join(raw, file), 'utf8')) as HarnessResult;
    sums[build].add(`${result.input.checksum} → ${result.output.checksum}`);
    for (const run of result.runs) {
      const derived: Record<string, number> = { ...run };
      if ('endToEndMs' in run) derived.overheadMs = run.endToEndMs - run.computeMs - run.storageMs;
      if ('batchEndToEndMs' in run) derived.batchOverheadMs = run.batchEndToEndMs - run.batchComputeMs;
      for (const [metric, v] of Object.entries(derived)) {
        values[metric] ??= { jsCore: [], kmpCore: [] };
        values[metric][build].push(v);
      }
    }
  }
  for (const [metric, byBuild] of Object.entries(values)) {
    if (byBuild.jsCore.length > 1 && byBuild.kmpCore.length > 1) compare(scenario, metric, 'ms', byBuild, rows, verdicts);
  }
  const same = sums.jsCore.size === 1 && sums.kmpCore.size === 1 && [...sums.jsCore][0] === [...sums.kmpCore][0];
  verdicts.push(
    `${scenario} inputs and outputs ${same ? 'identical in both builds' : 'DIFFER between builds'}: ` +
      `jsCore ${[...sums.jsCore].join(', ')} · kmpCore ${[...sums.kmpCore].join(', ')}`,
  );
  collectRetries(raw, scenario, verdicts);
}

/** <dir>/retries.csv (bm-harness.sh): cold starts relaunched because none of their log lines arrived. */
function collectRetries(dir: string, label: string, verdicts: string[]) {
  const file = join(dir, 'retries.csv');
  if (!existsSync(file)) return;
  const rows = readFileSync(file, 'utf8').trim().split('\n').slice(1).filter(Boolean);
  verdicts.push(
    `${label}: ${rows.length} cold start(s) relaunched (excluded, §4.3)` +
      (rows.length ? `: ${rows.map((r) => r.split(',').slice(0, 2).join(' ')).join('; ')}` : ''),
  );
}

/**
 * Memory rounds (bm-harness.sh MEMORY=1): <scenario>/memory/<round>-<build>{-rss.txt,
 * -logcat.txt, -status.txt, -meminfo.txt}. RSS samples ("<epoch s> <VmRSS kB> <VmSwap kB>") are
 * lined up with the harness's bench-mark lines (logcat -v epoch, same clock). Per round:
 * start = median RSS over the first second sampled (before setup and warm-up); baseline =
 * median RSS over the idle second before measure-start (after them); peak = max RSS from
 * measure-start to measure-end. Per measured op: max RSS between op-start and op-end minus the
 * last sample before op-start. Plus VmHWM and `dumpsys meminfo` taken after the run.
 */
const MEMORY_BASELINE_S = 1; // harness MEMORY_SETTLE_MS
const MEMINFO_METRICS: { metric: string; rx: RegExp }[] = [
  { metric: 'meminfoTotalPss', rx: /TOTAL PSS:\s+(\d+)/ },
  { metric: 'meminfoTotalRss', rx: /TOTAL RSS:\s+(\d+)/ },
  { metric: 'meminfoJavaHeapPss', rx: /^\s*Java Heap:\s+(\d+)/m },
  { metric: 'meminfoNativeHeapPss', rx: /^\s*Native Heap:\s+(\d+)\s+\d+\s*$/m },
];

function collectMemory(raw: string, scenario: string, rows: Row[], verdicts: string[]) {
  const dir = join(raw, 'memory');
  if (!existsSync(join(dir, 'meta.json'))) return;
  const mb = (kb: number) => kb / 1024;
  const values: Record<string, Record<Build, number[]>> = {};
  const add = (metric: string, build: Build, v: number) => {
    values[metric] ??= { jsCore: [], kmpCore: [] };
    values[metric][build].push(v);
  };
  const sums: Record<Build, Set<string>> = { jsCore: new Set(), kmpCore: new Set() };
  const problems: string[] = [];
  const gapsMs: number[] = [];
  let swapRounds = 0;
  let rounds = 0;

  for (const file of readdirSync(dir).filter((f) => /^\d+-(jsCore|kmpCore)\.json$/.test(f)).sort()) {
    const base = join(dir, file.replace('.json', ''));
    const build = file.split('-')[1].replace('.json', '') as Build;
    const result = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as HarnessResult;
    sums[build].add(`${result.input.checksum} → ${result.output.checksum}`);

    const marks = new Map<string, number>();
    for (const line of readFileSync(`${base}-logcat.txt`, 'utf8').split('\n')) {
      const m = /^\s*(\d+\.\d+)\s.*\[Pocketly\] bench-mark (.+)$/.exec(line);
      if (m) marks.set(m[2].trim(), Number(m[1]));
    }
    const samples = readFileSync(`${base}-rss.txt`, 'utf8')
      .trim()
      .split('\n')
      .map((l) => l.split(' ').map(Number))
      .filter((s) => s.length === 3 && s.every(Number.isFinite))
      .map(([t, rss, swap]) => ({ t, rss, swap }));
    const start = marks.get('measure-start');
    const end = marks.get('measure-end');
    if (start === undefined || end === undefined || samples.length === 0) {
      problems.push(`${file}: missing markers or samples`);
      continue;
    }
    const between = (from: number, to: number) => samples.filter((s) => s.t >= from && s.t <= to);
    const idle = between(start - MEMORY_BASELINE_S, start);
    const block = between(start, end);
    if (idle.length < 10 || block.length < 2) {
      problems.push(`${file}: only ${idle.length} baseline / ${block.length} measured samples`);
      continue;
    }
    rounds++;
    for (let i = 1; i < block.length; i++) gapsMs.push((block[i].t - block[i - 1].t) * 1000);
    const first = samples.filter((s) => s.t <= samples[0].t + 1);
    add('rssStart', build, mb(stats(first.map((s) => s.rss)).median));
    const baseline = stats(idle.map((s) => s.rss)).median;
    const peak = Math.max(...block.map((s) => s.rss));
    add('rssBaseline', build, mb(baseline));
    add('rssPeak', build, mb(peak));
    add('rssPeakOverBaseline', build, mb(peak - baseline));
    const swaps = [...idle, ...block].map((s) => s.swap);
    if (Math.max(...swaps) - Math.min(...swaps) > 1024) swapRounds++;

    for (let i = 0; marks.has(`op-start ${i}`); i++) {
      const opStart = marks.get(`op-start ${i}`)!;
      const opEnd = marks.get(`op-end ${i}`);
      const before = samples.filter((s) => s.t <= opStart).at(-1);
      if (opEnd === undefined || !before) continue;
      const during = between(opStart, opEnd);
      add('rssOpDelta', build, mb(Math.max(before.rss, ...during.map((s) => s.rss)) - before.rss));
    }

    const hwm = /^VmHWM:\s+(\d+)/m.exec(readFileSync(`${base}-status.txt`, 'utf8'));
    if (hwm) add('vmHwm', build, mb(Number(hwm[1])));
    const meminfo = readFileSync(`${base}-meminfo.txt`, 'utf8');
    for (const { metric, rx } of MEMINFO_METRICS) {
      const m = rx.exec(meminfo);
      if (m) add(metric, build, mb(Number(m[1])));
    }
  }

  for (const [metric, byBuild] of Object.entries(values)) {
    if (byBuild.jsCore.length > 1 && byBuild.kmpCore.length > 1) compare(scenario, metric, 'MB', byBuild, rows, verdicts);
  }
  const same = sums.jsCore.size === 1 && sums.kmpCore.size === 1 && [...sums.jsCore][0] === [...sums.kmpCore][0];
  const gap = gapsMs.length ? stats(gapsMs) : undefined;
  verdicts.push(
    `${scenario} memory rounds: ${rounds} usable cold starts` +
      (gap ? `, RSS sampled every ${gap.median.toFixed(1)} ms (median; max gap ${gap.max.toFixed(1)} ms)` : '') +
      `, VmSwap moved > 1 MB in ${swapRounds} round(s), inputs and outputs ${same ? 'identical in both builds' : 'DIFFER between builds'}` +
      (problems.length ? ` · ⚠ skipped: ${problems.join('; ')}` : ''),
  );
  collectRetries(dir, `${scenario} memory rounds`, verdicts);
}

/**
 * `dumpsys gfxinfo` per iteration (<scenario>/gfxinfo/<block>-<build>/<n>.txt), reset right
 * before the measured part: frame-level numbers that don't drop when the list is at rest.
 */
const GFX_METRICS: { metric: string; unit: string; rx: RegExp }[] = [
  { metric: 'jankyFrames', unit: '%', rx: /^Janky frames: \d+ \(([\d.]+)%\)/m },
  { metric: 'frameTimeP90', unit: 'ms', rx: /^90th percentile: (\d+)ms/m },
  { metric: 'frameTimeP99', unit: 'ms', rx: /^99th percentile: (\d+)ms/m },
  { metric: 'framesRendered', unit: 'frames', rx: /^Total frames rendered: (\d+)/m },
];

function collectGfxinfo(raw: string, scenario: string, rows: Row[], verdicts: string[]) {
  const dir = join(raw, 'gfxinfo');
  if (!existsSync(dir)) return;
  const values: Record<string, Record<Build, number[]>> = {};
  for (const block of readdirSync(dir).filter((d) => /^\d+-(jsCore|kmpCore)$/.test(d)).sort()) {
    const build = block.split('-')[1] as Build;
    for (const file of readdirSync(join(dir, block)).filter((f) => /^\d+\.txt$/.test(f)).sort()) {
      const text = readFileSync(join(dir, block, file), 'utf8');
      for (const { metric, rx } of GFX_METRICS) {
        const m = rx.exec(text);
        if (!m) continue;
        values[metric] ??= { jsCore: [], kmpCore: [] };
        values[metric][build].push(Number(m[1]));
      }
    }
  }
  for (const { metric, unit } of GFX_METRICS) {
    const v = values[metric];
    if (v && v.jsCore.length > 1 && v.kmpCore.length > 1) compare(scenario, metric, unit, v, rows, verdicts);
  }
}

/** <scenario>/temperatures.csv: battery temperature at the start of each block. */
function collectTemperatures(raw: string, scenario: string, verdicts: string[]) {
  const file = join(raw, 'temperatures.csv');
  if (!existsSync(file)) return;
  const byBuild: Record<Build, number[]> = { jsCore: [], kmpCore: [] };
  for (const line of readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
    const [, build, startC] = line.split(',');
    byBuild[build as Build].push(Number(startC));
  }
  const fmt = (v: number[]) =>
    `${mean(v).toFixed(1)} °C (${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}, ${v.length} blocks)`;
  verdicts.push(`${scenario} battery at block start: jsCore ${fmt(byBuild.jsCore)}, kmpCore ${fmt(byBuild.kmpCore)}`);
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
  // Two effects mix in the total (ADR-0009): the KMP architecture itself, and the storage
  // choice (op-sqlite bundles its own SQLite into jsCore; kmpCore uses the platform's).
  const STORAGE_LIBS = ['libop-sqlite.so'];
  const storage = STORAGE_LIBS.reduce((d, l) => d + (kmp.nativeLibs[l] ?? 0) - (js.nativeLibs[l] ?? 0), 0);
  const total = kmp.fileBytes - js.fileBytes;
  if (storage !== 0) {
    extra.push(
      '',
      '### BM-08 split, arm64-v8a APK (kmpCore − jsCore)',
      '',
      '| Effect | Δ |',
      '|---|---:|',
      `| Storage choice (${STORAGE_LIBS.join(', ')}, bundled in jsCore only) | ${delta(storage)} |`,
      `| KMP architecture (everything else: Nitro bridge library, Kotlin dex, smaller JS bundle) | ${delta(total - storage)} |`,
      `| Total | ${delta(total)} |`,
    );
    verdicts.push(`BM-08 arm64-v8a APK split: architecture ${delta(total - storage)}, storage choice ${delta(storage)} → total ${delta(total)}`);
  }
  const kept = data.keptClassesByOrigin;
  if (kept?.kmpCore) {
    extra.push('', 'Classes kept by R8, by origin (from mapping.txt; counts, not bytes):', '', '| Origin | jsCore | kmpCore |', '|---|---:|---:|');
    for (const k of Object.keys(kept.kmpCore).sort()) extra.push(`| ${k} | ${kept.jsCore[k] ?? 0} | ${kept.kmpCore[k]} |`);
  }
}

function collectDownload(dir: string, verdicts: string[], extra: string[]) {
  const raw = join(dir, 'bm-08-download');
  if (!existsSync(join(raw, 'meta.json'))) return;
  const read = (build: Build) =>
    Object.fromEntries(
      readFileSync(join(raw, `${build}.csv`), 'utf8')
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => {
          const [abi, min, max] = line.split(',');
          return [abi, { min: Number(min), max: Number(max) }];
        }),
    );
  const js = read('jsCore');
  const kmp = read('kmpCore');
  extra.push('', '### BM-08 download size (bundletool get-size total, per ABI)', '', '| ABI | jsCore | kmpCore | Δ (max) |', '|---|---:|---:|---:|');
  for (const abi of Object.keys(js)) {
    const d = kmp[abi].max - js[abi].max;
    extra.push(`| ${abi} | ${kb(js[abi].min)}–${kb(js[abi].max)} | ${kb(kmp[abi].min)}–${kb(kmp[abi].max)} | ${delta(d)} (${((d / js[abi].max) * 100).toFixed(1)}%) |`);
    if (abi === 'arm64-v8a') {
      verdicts.push(`BM-08 download arm64-v8a: kmpCore ${kb(kmp[abi].max)} vs jsCore ${kb(js[abi].max)} → ${delta(d)} (${((d / js[abi].max) * 100).toFixed(1)}%)`);
    }
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
  collectFlashlight(dir, 'BM-02', rows, verdicts);
  for (const scenario of ['BM-03', 'BM-04', 'BM-04b', 'BM-06', 'BM-11']) {
    collectHarness(dir, scenario, rows, verdicts);
    collectMemory(join(dir, scenario.toLowerCase()), scenario, rows, verdicts);
  }
  collectSize(dir, rows, verdicts, extra);
  collectDownload(dir, verdicts, extra);

  const header = 'scenario,metric,build,unit,n,median,p90,p25,p75,iqr,mean,cv,min,max';
  const csv = rows.map((r) => {
    const s = r.stats;
    return [r.scenario, r.metric, r.build, r.unit, s.n, s.median, s.p90, s.p25, s.p75, s.iqr, s.mean, s.cv, s.min, s.max]
      .map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(4) : v))
      .join(',');
  });
  writeFileSync(join(dir, 'summary.csv'), [header, ...csv].join('\n') + '\n');

  const md = ['# Summary', '', `_Generated by benchmarks/scripts/collect.ts from raw files in this folder._`, ''];
  const measured = rows.filter((r) => r.unit !== 'bytes');
  if (measured.length) {
    md.push('| Scenario | Metric | Build | n | Median | p90 | IQR (p25–p75) | CV |', '|---|---|---|---:|---:|---:|---|---:|');
    for (const r of measured) {
      const s = r.stats;
      md.push(`| ${r.scenario} | ${r.metric} | ${r.build} | ${s.n} | ${s.median.toFixed(1)} ${r.unit} | ${s.p90.toFixed(1)} ${r.unit} | ${s.iqr.toFixed(1)} (${s.p25.toFixed(1)}–${s.p75.toFixed(1)}) | ${(s.cv * 100).toFixed(1)}% |`);
    }
    md.push('');
  }
  if (comparisons.length) {
    md.push(
      '## kmpCore − jsCore',
      '',
      'Shift = Hodges–Lehmann estimate (median of all pairwise differences); 95% CI is distribution-free (Moses).',
      '',
      '| Scenario | Metric | Δ median | Shift | 95% CI | p (Mann-Whitney) | Meaningful? |',
      '|---|---|---:|---:|---|---:|---|',
    );
    for (const c of comparisons) {
      const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
      md.push(`| ${c.scenario} | ${c.metric} | ${f(c.diffPct)}% | ${f(c.shift)} ${c.unit} | ${f(c.low)} to ${f(c.high)} ${c.unit} | ${c.p.toFixed(3)} | ${c.meaningful ? 'yes' : 'no'} |`);
    }
    md.push('');
  }
  md.push('## Verdicts', '', ...verdicts.map((v) => `- ${v}`), '', ...extra, '');
  writeFileSync(join(dir, 'summary.md'), md.join('\n'));
  console.log(md.join('\n'));
}

main();
