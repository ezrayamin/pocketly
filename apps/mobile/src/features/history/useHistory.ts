import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SpendingSummary,
  StaleInfo,
  Transaction,
  TransactionStatus,
  TransactionType,
  TxFilter,
} from '@pocketly/core-contract';
import { core } from '../../core';
import { toUserError, type UserError } from '../errors';
import { localMonth } from '../home/presentation';

export const HISTORY_PAGE_SIZE = 20; // FR-HIST-01

/** FR-HIST-03 type filters. Transfers covers both directions. */
export type TypeGroup = 'TRANSFER' | 'TOP_UP' | 'QR_PAYMENT';

export const TYPE_GROUP_TYPES: Record<TypeGroup, TransactionType[]> = {
  TRANSFER: ['TRANSFER_IN', 'TRANSFER_OUT'],
  TOP_UP: ['TOP_UP'],
  QR_PAYMENT: ['QR_PAYMENT'],
};

/** FR-HIST-03: one type group and one status at most; null means "all". */
export interface HistoryFilter {
  type: TypeGroup | null;
  status: TransactionStatus | null;
}

export const NO_FILTER: HistoryFilter = { type: null, status: null };

function toTxFilter(filter: HistoryFilter): TxFilter | undefined {
  if (!filter.type && !filter.status) return undefined;
  return {
    types: filter.type ? TYPE_GROUP_TYPES[filter.type] : undefined,
    statuses: filter.status ? [filter.status] : undefined,
  };
}

interface Page {
  /** null until the first page of the current filter arrives. */
  items: Transaction[] | null;
  nextCursor?: string;
  stale?: StaleInfo;
}

export interface HistoryState {
  items: Transaction[] | null;
  hasMore: boolean;
  /** The first page is the local replica: the refresh couldn't reach the server (FR-HIST-04). */
  stale?: StaleInfo;
  /** The first page failed. With nothing cached this is all there is; otherwise the old list stays. */
  error: UserError | null;
  /** The next page failed. onEndReached won't retry it; `loadMore(true)` does. */
  loadMoreError: UserError | null;
  loadingMore: boolean;
  refreshing: boolean;
  /** This month's totals (all transactions, whatever the filter), from the replica. */
  month: SpendingSummary | null;
  filter: HistoryFilter;
  setFilter: (filter: HistoryFilter) => void;
  refresh: () => void;
  loadMore: (retry?: boolean) => void;
}

/**
 * History list state (F4). The first page refreshes the replica from the server; later pages
 * read the replica (ADR-0009), so scrolling works offline and nothing shifts mid-scroll.
 */
export function useHistory(reloadToken = 0): HistoryState {
  const [filter, setFilterState] = useState<HistoryFilter>(NO_FILTER);
  const [page, setPage] = useState<Page>({ items: null });
  const [error, setError] = useState<UserError | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<UserError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState<SpendingSummary | null>(null);
  const mounted = useRef(true);
  // Each first-page load starts a generation. Responses from an older one (a previous filter,
  // a superseded refresh) are dropped, page appends included (ADR-0007).
  const generation = useRef(0);
  // The cursor being fetched: one request per cursor, so a burst of onEndReached calls
  // can't append the same page twice.
  const pendingCursor = useRef<string | null>(null);

  const loadFirst = useCallback(async (f: HistoryFilter) => {
    const gen = ++generation.current;
    const isCurrent = () => mounted.current && gen === generation.current;
    pendingCursor.current = null;
    setLoadingMore(false);
    setLoadMoreError(null);
    try {
      const first = await core.getTransactions(undefined, HISTORY_PAGE_SIZE, toTxFilter(f));
      if (!isCurrent()) return;
      setPage({ items: first.items, nextCursor: first.nextCursor, stale: first.stale });
      setError(null);
      // After the first page: its refresh is what brings the replica up to date.
      core.computeSpendingSummary(localMonth(Date.now())).then(
        (summary) => isCurrent() && setMonth(summary),
        () => {}, // the card keeps its last value
      );
    } catch (e) {
      if (isCurrent()) setError(toUserError(e));
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // First load, a filter change, or an outside reload (developer menu, dev links).
  useEffect(() => {
    loadFirst(filter);
  }, [filter, reloadToken, loadFirst]);

  const setFilter = useCallback(
    (next: HistoryFilter) => {
      if (next.type === filter.type && next.status === filter.status) return;
      setPage({ items: null }); // a different list: show the skeleton, not the old rows
      setError(null);
      setFilterState(next);
    },
    [filter],
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    loadFirst(filter);
  }, [filter, loadFirst]);

  const loadMore = useCallback(
    (retry = false) => {
      const cursor = page.nextCursor;
      if (!cursor || pendingCursor.current === cursor || (loadMoreError && !retry)) return;
      const gen = generation.current;
      const isCurrent = () => mounted.current && gen === generation.current;
      pendingCursor.current = cursor;
      setLoadingMore(true);
      setLoadMoreError(null);
      core.getTransactions(cursor, HISTORY_PAGE_SIZE, toTxFilter(filter)).then(
        (next) => {
          if (!isCurrent()) return;
          pendingCursor.current = null;
          setLoadingMore(false);
          // Append only onto the list this cursor was taken from.
          setPage((p) =>
            p.nextCursor === cursor && p.items
              ? { ...p, items: [...p.items, ...next.items], nextCursor: next.nextCursor }
              : p,
          );
        },
        (e: unknown) => {
          if (!isCurrent()) return;
          pendingCursor.current = null;
          setLoadingMore(false);
          setLoadMoreError(toUserError(e));
        },
      );
    },
    [page.nextCursor, filter, loadMoreError],
  );

  return {
    items: page.items,
    hasMore: page.nextCursor !== undefined,
    stale: page.stale,
    error,
    loadMoreError,
    loadingMore,
    refreshing,
    month,
    filter,
    setFilter,
    refresh,
    loadMore,
  };
}
