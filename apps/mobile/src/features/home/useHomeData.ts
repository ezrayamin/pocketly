import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpendingSummary, Transaction, Wallet } from '@pocketly/core-contract';
import { toCoreError } from '@pocketly/core-contract';
import { uiPreferences } from '@pocketly/native-preferences';
import { core } from '../../core';
import { localMonth } from './presentation';

export const RECENT_COUNT = 5; // FR-HOME-04

export interface HomeData {
  wallet: Wallet;
  recent: Transaction[];
  month: SpendingSummary;
  /** Device time of the last successful load (FR-HOME-05 "Last updated hh:mm"). */
  loadedAt: number;
}

export interface HomeState {
  data: HomeData | null;
  error: string | null;
  refreshing: boolean;
  balanceHidden: boolean;
  refresh: () => Promise<void>;
  toggleBalanceHidden: () => void;
}

async function load(): Promise<HomeData> {
  const [wallet, recent] = await Promise.all([core.getWallet(), core.getTransactions(undefined, RECENT_COUNT)]);
  const month = await core.computeSpendingSummary(localMonth(wallet.updatedAt));
  return { wallet, recent: recent.items, month, loadedAt: Date.now() };
}

/** Home screen state. Wallet data comes from the core; hide/show is a UI preference (ADR-0005). */
export function useHomeData(): HomeState {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const mounted = useRef(true);

  const run = useCallback(async () => {
    try {
      const next = await load();
      if (mounted.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(toCoreError(e).message);
    }
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
    await run();
    if (mounted.current) setRefreshing(false);
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
