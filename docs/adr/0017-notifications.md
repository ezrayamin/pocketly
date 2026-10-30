# ADR-0017: Notifications: a server event log, delivered once, kept in the replica

**Status:** Accepted · 2026-10-30 · Implements F9 (FR-NOTIF-01..03), FR-FAKE-05's `WalletEvent` · Builds on ADR-0007, ADR-0009, ADR-0011, ADR-0014

## Context

F9 tells the user when money arrives (FR-NOTIF-01) and when a pending transaction resolves
(FR-NOTIF-02), keeps the last 50 notifications with an unread badge on Home (FR-NOTIF-03), and
is in-app only (no APNs/FCM, requirements §5). Requirements §4.1 gives the backend an
`incomingEvents(): Flow<WalletEvent>`, and FR-FAKE-05 says held transfers emit one when they
settle. It's the first product stream from Kotlin to JS (NFR-ARCH-04); prices (BM-05) are the
only other one and are parked.

Today: the Home banner is a static placeholder built from history, held transfers and top-ups
settle **lazily** (on the next server call, ADR-0014 §4), and nothing reaches the app unless it
asks.

## Decisions

### 1. The server keeps an event log; the stream is a view of it

- The fake server appends to `server_event` (id = a sequence number, kind, transaction id,
  created at) in the **same database transaction** as the change it describes: an incoming
  transfer (`simulateIncomingTransfer`), and a held or processing transaction settling (the
  settlement in ADR-0014 §4 / ADR-0015 §4). No event can be lost between the change and the log.
- **Settling on time, not lazily:** a held transaction gets an in-process timer for its
  `resolve_at`, so its event appears 5–20 s later while the app runs (FR-FAKE-05). The lazy
  path stays for a process that died in between: the next start settles what's due and logs
  those events then.
- `WalletApi` gains `getEvents(afterId, limit)` (a page of the log) and `incomingEvents()` (a
  Kotlin `Flow` / JS async iterator of "the log grew" signals). The core always **reads the log**
  after a signal, so a missed signal costs a delay, never an event. With a real backend this is
  a websocket plus the same catch-up call.

### 2. The core delivers each event once and keeps the notifications

- An `EventSync` in each core (beside LedgerSync) remembers the last event id applied (cache
  meta). After a signal, on start and on each foreground refresh, it pages through
  `getEvents(afterId)`, then for each event, **in one cache transaction**: upserts the
  transaction into the replica (history and balance update, NFR-MONEY-03), inserts the
  notification, and advances the cursor. Event ids are unique keys in the notifications table,
  so an event that arrives twice is skipped (at-least-once delivery, applied once).
- Notifications live in the **cache database** (`cache_notification`, cache schema 2): id,
  kind, transaction id, created at, read. The newest 50 are kept (FR-NOTIF-03); older ones are
  deleted in the same transaction. They are user data, so `logout` clears them with the rest
  of the replica (NFR-SEC-05); `resetData` clears them and the cursor.
- **Which events notify:**
  - `MONEY_RECEIVED`: an incoming transfer (FR-NOTIF-01).
  - `TRANSACTION_SETTLED`: a transfer, top-up or QR payment that this install saw PENDING
    settled SUCCESS or FAILED (FR-NOTIF-02). The PaymentFlow's attempt for it moves to the same
    state (as `getTransferStatus` would), so an open result screen and a later status check
    agree with the notification. This covers a pending transaction from before the app was
    killed (NFR-REL-03): its event is in the log, and the catch-up on start applies it.
- Settling the client's own attempt through `getTransferStatus` first, then getting the event,
  is fine: the replica upsert is idempotent and the notification still appears once.

### 3. The contract: three methods

| Method | Does |
|---|---|
| `subscribeNotifications(onNew)` | A Nitro callback plus a subscription HybridObject (as `subscribePrices`, ADR-0002): `onNew(notifications)` with what each catch-up added, newest first. Unsubscribing stops delivery, not the syncing |
| `getNotifications()` | `NotificationList` { items (≤ 50, newest first), unreadCount } from the cache: works offline |
| `markNotificationsRead()` | All read; the badge clears |

New types: `AppNotification` { id, kind, transaction, createdAt, read }, `NotificationKind`,
`NotificationList`, and the subscription object. The **text is the app's** (amounts formatted
by the core, NFR-ARCH-01): "+$25.00 from Andi Pratama", "Your transfer to Budi went through",
"Your top-up didn't go through". About +110 KB of kmpCore bridge at ADR-0002's rate.

### 4. The app

- **Banner** (FR-NOTIF-01/02): a transient in-app banner for each new notification, tap →
  transaction detail; replaces Home's placeholder. Home and History reload behind it.
- **Locked app** (ADR-0011): while the lock screen is up, new notifications queue in JS and show
  after unlocking; the lock screen never shows an amount or a name. Nothing is shown while the
  app is in the background (in-app only).
- **Bell and list** (FR-NOTIF-03): the Home header's bell gets the unread badge (count, "9+"
  above 9) and opens a Notifications stack screen (product §7.4); opening it marks all read.
- **Developer menu:** "Trigger incoming transfer" (FR-DEV-04) now produces a real notification.

### 5. Testing

- Fixture `fixtures/events.json`: server steps (incoming, held settle) and the event ids they
  log; both cores' server tests walk it.
- Contract suite "Notifications" block: an incoming transfer notifies once, even after a
  duplicate signal and a restart; a held transfer that settles notifies and moves its attempt;
  the 51st notification drops the oldest; logout clears them; `getNotifications` works offline.
- Jest: banner, badge, list, the locked-queue rule. Maestro: dev link `pocketly://dev/incoming`
  → banner → list.

## Consequences

- Server schema 4 adds `server_event` (with ADR-0016's tables); cache schema 2 adds
  `cache_notification`, migrated in place (`1.sqm` for the cache).
- The fake server now runs timers (settlement); tests use the frozen clock plus an explicit
  "run due timers" hook, as `advanceServerClock` does today.
- BM-05's parked stream work is untouched; this stream is low-rate and isn't benchmarked.

## Limits

- In-app only: nothing reaches the user while the app isn't running (requirements §5).
- One account per install, and the event log isn't trimmed (the fake's datasets are small).
