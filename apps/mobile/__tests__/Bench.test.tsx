/**
 * @format
 */

import { checksum, logResult, runBench, type BenchResult } from '../src/bench/harness';
import { core } from '../src/core';
import { parseLaunchArgs } from '../src/launchArgs';

const opts = { runs: 2, warmup: 1, scale: 0.02 };

describe('bench harness (benchmarking.md §5.2)', () => {
  it('BM-03 times the spending summary: end-to-end, compute and storage per measured run', async () => {
    const r = await runBench('BM-03', opts);
    expect(r.runs).toHaveLength(2); // warm-up discarded
    for (const run of r.runs) {
      expect(Object.keys(run).sort()).toEqual(['computeMs', 'endToEndMs', 'storageMs']);
      expect(run.endToEndMs).toBeGreaterThanOrEqual(0);
    }
    expect(r.input.description).toContain('seed 7 × 200');
    expect(r.output.checksum).toMatch(/^[0-9a-f]{8}:\d+$/);
  });

  it('BM-04 ingests the same payload onto the same replica every run', async () => {
    const r = await runBench('BM-04', opts);
    expect(r.runs).toHaveLength(2);
    expect(r.input.description).toContain('seed 2026 × 100');
    // Every run starts from DEFAULT_DATASET, so every run accepts the whole payload.
    const { output } = r;
    expect(output.checksum).toBe(checksum(JSON.stringify({ accepted: 100, rejected: 0, duplicates: 0, errors: [] })));
  });

  it('BM-06 formats the same amounts one by one and in one batch, and echoes them', async () => {
    const r = await runBench('BM-06', opts);
    expect(Object.keys(r.runs[0]).sort()).toEqual(['batchComputeMs', 'batchEndToEndMs', 'chattyEndToEndMs', 'echoEndToEndMs']);
    expect(r.output.checksum).not.toBe(checksum('MISMATCH'));
  });

  it('BM-11 unlocks with the PIN it set, probes the JS thread, and leaves no PIN behind', async () => {
    const r = await runBench('BM-11', opts);
    expect(Object.keys(r.runs[0]).sort()).toEqual(['jsMaxGapMs', 'unlockMs']);
    expect(r.output.checksum).toBe(checksum('UNLOCKED'));
    expect((await core.getAuthState()).pinSet).toBe(false);
  });

  it('BM-04b ingests the same payload, staged in the core before each timed call', async () => {
    const plain = await runBench('BM-04', opts);
    const staged = await runBench('BM-04b', opts);
    expect(staged.runs).toHaveLength(2);
    expect(Object.keys(staged.runs[0]).sort()).toEqual(['computeMs', 'endToEndMs', 'storageMs']);
    expect(staged.input.checksum).toBe(plain.input.checksum);
    expect(staged.output.checksum).toBe(plain.output.checksum);
    expect(staged.input.description).toContain('staged in the core');
  });

  it('logs no markers in timing rounds, and phase markers around each measured op in memory rounds', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const marks = () => info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[Pocketly] bench-mark '));
    await runBench('BM-04', opts);
    expect(marks()).toEqual([]);
    await runBench('BM-04', { ...opts, memory: true });
    expect(marks().map((l) => l.replace('[Pocketly] bench-mark ', ''))).toEqual([
      'measure-start',
      'op-start 0',
      'op-end 0',
      'op-start 1',
      'op-end 1',
      'measure-end',
    ]);
    info.mockRestore();
  });

  it('logs results in chunks that join back into the same JSON', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const result: BenchResult = {
      scenario: 'BM-06',
      build: 'js',
      warmup: 0,
      runs: Array.from({ length: 300 }, (_, i) => ({ chattyEndToEndMs: i, batchEndToEndMs: i / 2, batchComputeMs: i / 3 })),
      input: { description: 'x', checksum: 'y' },
      output: { description: 'x', checksum: 'y' },
      setupMs: 1,
    };
    logResult(result);
    const lines = info.mock.calls.map((c) => String(c[0]));
    const chunks = lines.filter((l) => l.startsWith('[Pocketly] bench-chunk '));
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.map((l) => l.replace(/^\[Pocketly\] bench-chunk \d+\/\d+ /, '')).join('');
    expect(JSON.parse(joined)).toEqual(result);
    expect(lines[lines.length - 1]).toBe('[Pocketly] bench-done BM-06 js');
    info.mockRestore();
  });
});

describe('bench launch arguments', () => {
  it('reads the scenario with default and given counts', () => {
    expect(parseLaunchArgs({ bench: 'BM-03' }).bench).toEqual({ scenario: 'BM-03', runs: 10, warmup: 5, memory: false });
    expect(parseLaunchArgs({ bench: 'BM-04', benchRuns: '20', benchWarmup: '0', benchMemory: 'true' }).bench).toEqual({
      scenario: 'BM-04',
      runs: 20,
      warmup: 0,
      memory: true,
    });
  });

  it('rejects unknown scenarios and bad counts', () => {
    expect(() => parseLaunchArgs({ bench: 'BM-99' })).toThrow(/bench="BM-99"/);
    expect(() => parseLaunchArgs({ bench: 'BM-03', benchRuns: '0' })).toThrow(/benchRuns/);
    expect(() => parseLaunchArgs({ bench: 'BM-03', benchMemory: '1' })).toThrow(/benchMemory="1"/);
  });
});
