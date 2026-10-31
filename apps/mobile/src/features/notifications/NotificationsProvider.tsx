import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AppNotification } from '@pocketly/core-contract';
import { core } from '../../core';
import { useFirstScreenReady } from '../../firstScreen';
import { NotificationBanner } from './NotificationBanner';

/** At most this many banners wait; older ones are only in the list (a burst shouldn't take a minute). */
export const BANNER_QUEUE_MAX = 3;

/** Notifications start when the first screen shows real data, or after this long if none does (e.g. it failed). */
export const START_FALLBACK_MS = 2_000;

export interface NotificationsState {
  /** FR-NOTIF-03: the bell's badge. */
  unreadCount: number;
  /** Bumped when notifications arrive, so an open list reloads. */
  version: number;
  /** Opening the list (FR-NOTIF-03): every one read, the badge clears. */
  markAllRead(): Promise<void>;
}

const NotificationsContext = createContext<NotificationsState>({
  unreadCount: 0,
  version: 0,
  markAllRead: async () => {},
});

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext);
}

/**
 * F9 (ADR-0017 §4): subscribes to the core's notifications for as long as the app is mounted, keeps the
 * unread count, and shows a banner for each new one. It starts once the first screen shows real data (or after
 * START_FALLBACK_MS), so it adds nothing to startup; what arrives before is in the core's list and the count.
 * While `held` (the lock screen or the privacy cover is up, or the developer menu is open) banners wait: the
 * lock screen never shows an amount or a name (ADR-0011). The core keeps them either way.
 */
export function NotificationsProvider({
  held,
  refreshToken = 0,
  onNew,
  onView,
  children,
}: {
  held: boolean;
  /** Bumped when the backend changed under the app (developer menu, dev links): the count is re-read. */
  refreshToken?: number;
  /** New notifications arrived: Home and History reload behind the banner. */
  onNew?: () => void;
  /** The banner's View: the transaction. */
  onView: (notification: AppNotification) => void;
  children: React.ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [version, setVersion] = useState(0);
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const firstScreenReady = useFirstScreenReady();
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (firstScreenReady) return;
    const timer = setTimeout(() => setFallback(true), START_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [firstScreenReady]);
  const started = firstScreenReady || fallback;

  const readCount = useCallback(() => {
    core.getNotifications().then(
      (list) => setUnreadCount(list.unreadCount),
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!started) return;
    const sub = core.subscribeNotifications((added) => {
      // Newest first from the core; banners go oldest first, keeping the newest few.
      setQueue((q) => [...q, ...[...added].reverse()].slice(-BANNER_QUEUE_MAX));
      setVersion((v) => v + 1);
      readCount();
      onNewRef.current?.();
    });
    return () => sub.unsubscribe();
  }, [started, readCount]);

  useEffect(() => {
    if (started) readCount();
  }, [started, readCount, refreshToken]);

  const markAllRead = useCallback(async () => {
    await core.markNotificationsRead();
    setUnreadCount(0);
  }, []);

  const dismiss = useCallback((id: string) => setQueue((q) => q.filter((n) => n.id !== id)), []);
  const shown = held ? undefined : queue[0];

  return (
    <NotificationsContext.Provider value={{ unreadCount, version, markAllRead }}>
      {children}
      {shown && (
        <NotificationBanner
          key={shown.id}
          notification={shown}
          onDismiss={dismiss}
          onView={() => {
            dismiss(shown.id);
            onView(shown);
          }}
        />
      )}
    </NotificationsContext.Provider>
  );
}
