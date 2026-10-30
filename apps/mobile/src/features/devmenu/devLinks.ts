import { CoreError, LIVE_DATASET } from '@pocketly/core-contract';
import type { NetworkSimulation } from '@pocketly/core-contract';
import { core } from '../../core';

/**
 * Scriptable developer controls (ADR-0008), for Maestro flows and benchmark runners that
 * can't tap through the hidden menu:
 *
 *   pocketly://dev/network?mode=NORMAL&failureRatePercent=0&normalLatencyMs=300
 *   pocketly://dev/network?declineTopUps=true&topUpProcessingMs=0   (ADR-0015 §4)
 *   pocketly://dev/reset
 *   pocketly://dev/incoming
 *   pocketly://dev/limit?minor=100000           (FR-TRF-10: the server's daily transfer limit)
 *   pocketly://dev/scan?code=<url-encoded code>  (ADR-0016 §7: as if the scanner read it)
 *
 * Network params not given keep their current value. Only active when DEV_TOOLS_ENABLED.
 */
const LINK = /^pocketly:\/\/dev\/([a-z]+)\/?(?:\?(.*))?$/;
const NUMBER_PARAMS = [
  'failureRatePercent',
  'normalLatencyMs',
  'readTimeoutMs',
  'writeTimeoutMs',
  'seed',
  'topUpProcessingMs',
] as const;
const BOOLEAN_PARAMS = ['declineTopUps'] as const;

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

/**
 * Applies network params (`mode`, NUMBER_PARAMS and BOOLEAN_PARAMS, as strings) on top of the current
 * simulation. Shared with launch arguments. Throws CoreError(INVALID_ARGUMENT) on bad values.
 */
export function applyNetworkParams(params: Readonly<Record<string, string>>): NetworkSimulation {
  const next: NetworkSimulation = { ...core.getNetworkSimulation() };
  if (params.mode) next.mode = params.mode as NetworkSimulation['mode'];
  for (const key of NUMBER_PARAMS) {
    if (params[key] !== undefined) next[key] = Number(params[key]);
  }
  for (const key of BOOLEAN_PARAMS) {
    if (params[key] === 'true' || params[key] === 'false') next[key] = params[key] === 'true';
    else if (params[key] !== undefined) throw new CoreError('INVALID_ARGUMENT', `${key} must be true or false`);
  }
  core.setNetworkSimulation(next); // validates
  return core.getNetworkSimulation();
}

/** Applies a dev link. Returns null if `url` isn't one; throws CoreError on bad values. */
export async function applyDevLink(url: string): Promise<DevLinkResult | null> {
  const match = LINK.exec(url);
  if (!match) return null;
  const [, action, query] = match;
  switch (action) {
    case 'network': {
      return { action, detail: JSON.stringify(applyNetworkParams(parseQuery(query))) };
    }
    case 'reset':
      await core.resetData(LIVE_DATASET);
      return { action, detail: 'wallet reset to seeded data' };
    case 'limit': {
      const minor = Number(parseQuery(query).minor);
      await core.setDailyLimit(minor); // validates
      return { action, detail: `daily limit ${core.formatMoney(minor)}` };
    }
    case 'scan': {
      // The app opens the scanner screen with it; nothing changes in the core here.
      return { action, detail: parseQuery(query).code ?? '' };
    }
    case 'incoming': {
      const tx = await core.simulateIncomingTransfer();
      return { action, detail: `${tx.id} ${core.formatMoney(tx.amount)}` };
    }
    default:
      return { action, detail: 'unknown dev link (ignored)' };
  }
}
