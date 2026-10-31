import {
  CoreError,
  NETWORK_NORMAL,
  PENDING_RESOLVE_MAX_MS,
  PENDING_RESOLVE_MIN_MS,
  READ_TIMEOUT_MS,
  SLOW_LATENCY_MAX_MS,
  SLOW_LATENCY_MIN_MS,
  TOP_UP_PROCESSING_MAX_MS,
  TOP_UP_PROCESSING_MIN_MS,
  TRANSFER_TIMEOUT_MS,
} from '@pocketly/core-contract';
import type { NetworkMode, NetworkSimulation } from '@pocketly/core-contract';
import { SeededRandom } from '../random';

const MODES: readonly NetworkMode[] = ['NORMAL', 'SLOW', 'ALWAYS_FAIL', 'TIMEOUT', 'OFFLINE'];

/** Every field set, except topUpProcessingMs: absent means the seeded draw. */
type Normalized = Required<Omit<NetworkSimulation, 'topUpProcessingMs'>> & Pick<NetworkSimulation, 'topUpProcessingMs'>;

/**
 * How the server handles a top-up that reached it (ADR-0015 §4). HOLD: TIMEOUT mode, held as
 * PENDING and never answered, like a transfer. PROCESS: answered after processingMs. `declined`
 * is the developer menu's switch as it was when the top-up arrived.
 */
export type TopUpHandling =
  | { kind: 'HOLD'; holdMs: number; fails: boolean; declined: boolean }
  | { kind: 'PROCESS'; processingMs: number; declined: boolean };

/**
 * FR-FAKE-04: latency, failures and offline mode for the fake backend (developer menu).
 * Draw order is fixed (latency roll, then failure roll, for every NORMAL/SLOW/ALWAYS_FAIL
 * call; a delay roll, then an outcome roll, for a transfer or top-up in TIMEOUT mode; then a
 * processing roll for a top-up in the other modes, unless topUpProcessingMs is set) so both cores
 * produce the same sequence for the same seed.
 * Mirrors shared/.../data/fake/NetworkSimulator.kt.
 */
export class NetworkSimulator {
  private simulation: Normalized = normalize(NETWORK_NORMAL);
  private rng = new SeededRandom(1);

  set(simulation: NetworkSimulation): void {
    this.simulation = normalize(simulation);
    this.rng = new SeededRandom(this.simulation.seed);
  }

  get(): NetworkSimulation {
    return { ...this.simulation };
  }

  /**
   * Runs before a transfer reaches the server. In TIMEOUT mode the request arrives but its answer
   * never does (FR-FAKE-05): returns how long the server holds it as PENDING and whether it then
   * fails. Otherwise as beforeCall, and returns undefined.
   */
  async beforeTransfer(): Promise<{ holdMs: number; fails: boolean } | undefined> {
    if (this.simulation.mode !== 'TIMEOUT') {
      await this.beforeCall();
      return undefined;
    }
    return this.drawHold();
  }

  /** Runs before a top-up reaches the server: as beforeTransfer, then the processing time. */
  async beforeTopUp(): Promise<TopUpHandling> {
    const { mode, declineTopUps } = this.simulation;
    if (mode === 'TIMEOUT') return { kind: 'HOLD', ...this.drawHold(), declined: declineTopUps };
    await this.beforeCall();
    const fixed = this.simulation.topUpProcessingMs;
    const processingMs =
      fixed ?? TOP_UP_PROCESSING_MIN_MS + this.rng.nextInt(TOP_UP_PROCESSING_MAX_MS - TOP_UP_PROCESSING_MIN_MS + 1);
    return { kind: 'PROCESS', processingMs, declined: declineTopUps };
  }

  private drawHold(): { holdMs: number; fails: boolean } {
    const holdMs = PENDING_RESOLVE_MIN_MS + this.rng.nextInt(PENDING_RESOLVE_MAX_MS - PENDING_RESOLVE_MIN_MS + 1);
    const fails = this.rng.nextInt(100) < this.simulation.failureRatePercent;
    return { holdMs, fails };
  }

  /**
   * Runs before an event-log read (ADR-0017), the socket's channel: OFFLINE, TIMEOUT and ALWAYS_FAIL as
   * beforeCall, but no latency and no draws. The core reads the log by itself (after each signal, and
   * before each history refresh, one read at a time), so a draw here would shift the seeded sequence the
   * developer's own calls see, and a delay would hold a fast refresh behind a slow one.
   */
  async beforeEventRead(): Promise<void> {
    const { mode } = this.simulation;
    if (mode === 'OFFLINE') throw new CoreError('NETWORK_UNAVAILABLE', 'Simulated offline mode');
    if (mode === 'TIMEOUT') return new Promise<void>(() => {});
    if (mode === 'ALWAYS_FAIL') throw new CoreError('SERVER_ERROR', 'Simulated server error');
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

function normalize(s: NetworkSimulation): Normalized {
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
  const writeTimeoutMs = s.writeTimeoutMs ?? TRANSFER_TIMEOUT_MS;
  if (!Number.isInteger(writeTimeoutMs) || writeTimeoutMs < 100 || writeTimeoutMs > 60_000) {
    throw new CoreError('INVALID_ARGUMENT', 'writeTimeoutMs must be an integer 100..60000');
  }
  const seed = s.seed ?? 1;
  if (!Number.isInteger(seed)) {
    throw new CoreError('INVALID_ARGUMENT', 'seed must be an integer');
  }
  const declineTopUps = s.declineTopUps ?? false;
  if (typeof declineTopUps !== 'boolean') {
    throw new CoreError('INVALID_ARGUMENT', 'declineTopUps must be a boolean');
  }
  const { topUpProcessingMs } = s;
  if (
    topUpProcessingMs !== undefined &&
    (!Number.isInteger(topUpProcessingMs) || topUpProcessingMs < 0 || topUpProcessingMs > 60_000)
  ) {
    throw new CoreError('INVALID_ARGUMENT', 'topUpProcessingMs must be an integer 0..60000');
  }
  return {
    mode: s.mode,
    failureRatePercent: s.failureRatePercent,
    normalLatencyMs,
    readTimeoutMs,
    writeTimeoutMs,
    seed,
    declineTopUps,
    ...(topUpProcessingMs !== undefined ? { topUpProcessingMs } : {}),
  };
}
