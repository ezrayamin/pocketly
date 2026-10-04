import {
  CoreError,
  NETWORK_NORMAL,
  READ_TIMEOUT_MS,
  SLOW_LATENCY_MAX_MS,
  SLOW_LATENCY_MIN_MS,
} from '@pocketly/core-contract';
import type { NetworkMode, NetworkSimulation } from '@pocketly/core-contract';
import { SeededRandom } from '../random';

const MODES: readonly NetworkMode[] = ['NORMAL', 'SLOW', 'ALWAYS_FAIL', 'TIMEOUT', 'OFFLINE'];

/**
 * FR-FAKE-04: latency, failures and offline mode for the fake backend (developer menu).
 * Draw order is fixed (latency roll, then failure roll, for every NORMAL/SLOW/ALWAYS_FAIL
 * call) so both cores produce the same sequence for the same seed.
 * Mirrors shared/.../data/fake/NetworkSimulator.kt.
 */
export class NetworkSimulator {
  private simulation: Required<NetworkSimulation> = normalize(NETWORK_NORMAL);
  private rng = new SeededRandom(1);

  set(simulation: NetworkSimulation): void {
    this.simulation = normalize(simulation);
    this.rng = new SeededRandom(this.simulation.seed);
  }

  get(): NetworkSimulation {
    return { ...this.simulation };
  }

  /** Runs before every backend call: waits, then maybe fails. Never resolves in TIMEOUT. */
  async beforeCall(): Promise<void> {
    const { mode, failureRatePercent, normalLatencyMs } = this.simulation;
    if (mode === 'OFFLINE') {
      throw new CoreError('NETWORK_UNAVAILABLE', 'Simulated offline mode');
    }
    if (mode === 'TIMEOUT') {
      return new Promise<void>(() => {}); // the client-side timeout ends the call
    }
    const latencyRoll = this.rng.nextInt(SLOW_LATENCY_MAX_MS - SLOW_LATENCY_MIN_MS + 1);
    const failureRoll = this.rng.nextInt(100);
    const latency = mode === 'SLOW' ? SLOW_LATENCY_MIN_MS + latencyRoll : normalLatencyMs;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
    if (mode === 'ALWAYS_FAIL' || failureRoll < failureRatePercent) {
      throw new CoreError('SERVER_ERROR', 'Simulated server error');
    }
  }
}

function normalize(s: NetworkSimulation): Required<NetworkSimulation> {
  if (!(MODES as readonly string[]).includes(s.mode)) {
    throw new CoreError('INVALID_ARGUMENT', `Unknown network mode "${s.mode}"`);
  }
  if (!Number.isInteger(s.failureRatePercent) || s.failureRatePercent < 0 || s.failureRatePercent > 100) {
    throw new CoreError('INVALID_ARGUMENT', 'failureRatePercent must be an integer 0..100');
  }
  const normalLatencyMs = s.normalLatencyMs ?? 0;
  if (!Number.isInteger(normalLatencyMs) || normalLatencyMs < 0 || normalLatencyMs > 60_000) {
    throw new CoreError('INVALID_ARGUMENT', 'normalLatencyMs must be an integer 0..60000');
  }
  const readTimeoutMs = s.readTimeoutMs ?? READ_TIMEOUT_MS;
  if (!Number.isInteger(readTimeoutMs) || readTimeoutMs < 100 || readTimeoutMs > 60_000) {
    throw new CoreError('INVALID_ARGUMENT', 'readTimeoutMs must be an integer 100..60000');
  }
  const seed = s.seed ?? 1;
  if (!Number.isInteger(seed)) {
    throw new CoreError('INVALID_ARGUMENT', 'seed must be an integer');
  }
  return { mode: s.mode, failureRatePercent: s.failureRatePercent, normalLatencyMs, readTimeoutMs, seed };
}
