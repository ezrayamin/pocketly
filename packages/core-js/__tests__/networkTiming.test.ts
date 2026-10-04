import { READ_TIMEOUT_MS, SLOW_LATENCY_MAX_MS, SLOW_LATENCY_MIN_MS } from '@pocketly/core-contract';
import { JsCore } from '../src/jsCore';

/** Timing behaviour, on fake timers (the Kotlin mirror uses runTest virtual time). */
describe('network timing (FR-DEV-02, NFR-REL-01)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('SLOW answers after 2–5 s', async () => {
    const core = new JsCore();
    core.setNetworkSimulation({ mode: 'SLOW', failureRatePercent: 0 });
    let done = false;
    const call = core.getWallet().then(() => (done = true));
    await jest.advanceTimersByTimeAsync(SLOW_LATENCY_MIN_MS - 1);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(SLOW_LATENCY_MAX_MS - SLOW_LATENCY_MIN_MS + 1);
    await call;
    expect(done).toBe(true);
  });

  it('TIMEOUT gives up with NETWORK_TIMEOUT after READ_TIMEOUT_MS', async () => {
    const core = new JsCore();
    core.setNetworkSimulation({ mode: 'TIMEOUT', failureRatePercent: 0 });
    const call = core.getWallet();
    const assertion = expect(call).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await assertion;
  });

  it('NORMAL with latency waits exactly normalLatencyMs (BM-07 uses 300)', async () => {
    const core = new JsCore();
    core.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0, normalLatencyMs: 300 });
    let done = false;
    const call = core.getWallet().then(() => (done = true));
    await jest.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await call;
    expect(done).toBe(true);
  });
});
