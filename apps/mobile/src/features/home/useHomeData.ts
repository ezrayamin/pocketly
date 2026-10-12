import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpendingSummary, StaleInfo, Transaction, Wallet } from '@pocketly/core-contract';
import { uiPreferences } from '@pocketly/native-preferences';
import { core } from '../../core';
import { toUserError, type UserError } from '../errors';
import { localMonth } from './presentation';

export const RECENT_COUNT = 5; // FR-HOME-04

export interface HomeData {
  wallet: Wallet;
  recent: Transaction[];
  month: SpendingSummary;
  /** Set when the server was unreachable and this is the local replica (ADR-0009). */
  stale?: StaleInfo;
  /** When this data last came from the server (FR-HOME-05 "Last updated hh:mm"). */
  syncedAt: number;
}

export interface HomeState {
  data: HomeData | null;
  /**
   * Latest load/refresh failure. Data from the last success stays on screen (FR-HIST-04).
   * Rare: when the server is unreachable the core serves the replica (`data.stale`) instead.
   */
  error: UserError | null;
  refreshing: boolean;
  balanceHidden: boolean;
  refresh: () => Promise<void>;
  toggleBalanceHidden: () => void;
}

async function load(): Promise<HomeData> {
  const [wallet, recent] = await Promise.all([core.getWallet(), core.getTransactions(undefined, RECENT_COUNT)]);
  const month = await core.computeSpendingSummary(localMonth(wallet.updatedAt));
  const stale = wallet.stale ?? recent.stale;
  return { wallet, recent: recent.items, month, stale, syncedAt: stale?.cachedAt ?? Date.now() };
}

/** Home screen state. Wallet data comes from the core; hide/show is a UI preference (ADR-0005). */
export function useHomeData(): HomeState {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<UserError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const mounted = useRef(true);
  // Only the newest load may touch the screen: an older one finishing late (slow, timed
  // out, or failed) must not overwrite newer data or show a stale error (ADR-0007).
  const latest = useRef(0);

  /** Loads and applies; returns false if a newer load superseded this one. */
  const run = useCallback(async () => {
    const id = ++latest.current;
    const isCurrent = () => mounted.current && id === latest.current;
    try {
      const next = await load();
      if (isCurrent()) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (isCurrent()) setError(toUserError(e));
    }
    return isCurrent();
  }, []);

  useEffect(() => {
    mounted.current = true;
    run();
    uiPreferences.getBalanceHidden().then((hidden) => mounted.current && setBalanceHidden(hidden), () => {});
    return () => {
      mounted.current = false;
    };
  }, [run]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    if (await run()) setRefreshing(false);
  }, [run]);

  const toggleBalanceHidden = useCallback(() => {
    setBalanceHidden((hidden) => {
      const next = !hidden;
      // Optimistic: the toggle flips instantly, then persists (FR-HOME-02, ADR-0005).
      uiPreferences.setBalanceHidden(next).catch(() => mounted.current && setBalanceHidden(hidden));
      return next;
    });
  }, []);

  return { data, error, refreshing, balanceHidden, refresh, toggleBalanceHidden };
}
