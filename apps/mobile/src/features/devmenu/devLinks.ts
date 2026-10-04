import { LIVE_DATASET } from '@pocketly/core-contract';
import type { NetworkSimulation } from '@pocketly/core-contract';
import { core } from '../../core';

/**
 * Scriptable developer controls (ADR-0008), for Maestro flows and benchmark runners that
 * can't tap through the hidden menu:
 *
 *   pocketly://dev/network?mode=NORMAL&failureRatePercent=0&normalLatencyMs=300
 *   pocketly://dev/reset
 *   pocketly://dev/incoming
 *
 * Network params not given keep their current value. Only active when DEV_TOOLS_ENABLED.
 */
const LINK = /^pocketly:\/\/dev\/([a-z]+)\/?(?:\?(.*))?$/;
const NUMBER_PARAMS = ['failureRatePercent', 'normalLatencyMs', 'readTimeoutMs', 'seed'] as const;

export type DevLinkResult = { action: string; detail: string };

function parseQuery(query: string | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of (query ?? '').split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return params;
}

/** Applies a dev link. Returns null if `url` isn't one; throws CoreError on bad values. */
export async function applyDevLink(url: string): Promise<DevLinkResult | null> {
  const match = LINK.exec(url);
  if (!match) return null;
  const [, action, query] = match;
  switch (action) {
    case 'network': {
      const params = parseQuery(query);
      const next: NetworkSimulation = { ...core.getNetworkSimulation() };
      if (params.mode) next.mode = params.mode as NetworkSimulation['mode'];
      for (const key of NUMBER_PARAMS) {
        if (params[key] !== undefined) next[key] = Number(params[key]);
      }
      core.setNetworkSimulation(next); // validates; throws INVALID_ARGUMENT
      return { action, detail: JSON.stringify(core.getNetworkSimulation()) };
    }
    case 'reset':
      await core.resetData(LIVE_DATASET);
      return { action, detail: 'wallet reset to seeded data' };
    case 'incoming': {
      const tx = await core.simulateIncomingTransfer();
      return { action, detail: `${tx.id} ${core.formatMoney(tx.amount)}` };
    }
    default:
      return { action, detail: 'unknown dev link (ignored)' };
  }
}
