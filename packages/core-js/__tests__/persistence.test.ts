import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DATASET } from '@pocketly/core-contract';
import { testCore } from '../testing/testCore';

/** FR-FAKE-07 + FR-HIST-04 on real files: both databases survive a restart (new core, same files). */
describe('persistence across restarts (ADR-0009)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocketly-'));
  const files = { serverPath: join(dir, 'server.db'), cachePath: join(dir, 'cache.db') };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('server state, its counters and the replica all persist', async () => {
    const first = testCore({ ...files, dataset: DEFAULT_DATASET });
    await first.resetData(DEFAULT_DATASET);
    await first.simulateIncomingTransfer();
    expect((await first.getTransactions()).items[0].id).toBe('sim-000001'); // synced into the replica

    const second = testCore({ ...files, dataset: { ...DEFAULT_DATASET, seed: 999 } }); // seed ignored: not empty
    second.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    const offline = await second.getTransactions();
    expect(offline.stale?.reason).toBe('NETWORK_UNAVAILABLE');
    expect(offline.items[0].id).toBe('sim-000001'); // replica persisted

    second.setNetworkSimulation({ mode: 'NORMAL', failureRatePercent: 0 });
    expect((await second.simulateIncomingTransfer()).id).toBe('sim-000002'); // server counter persisted
    expect((await second.getTransactions()).items.slice(0, 2).map((t) => t.id)).toEqual(['sim-000002', 'sim-000001']);
  });
});
