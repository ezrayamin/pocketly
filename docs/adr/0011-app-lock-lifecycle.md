# ADR-0011: App lock lifecycle

**Status:** Accepted · 2026-10-13 · Implements FR-LOCK-01/02/03 · Builds on ADR-0005, ADR-0010

## Context

FR-LOCK-01 locks the app on a cold start (slice 5 step 2). FR-LOCK-02 locks it again after 60 s
in the background ("configurable in the dev menu"), and FR-LOCK-03 keeps its content out of the
app-switcher snapshot. Three questions: where the timeout lives, how "time in the background"
is measured, and how the snapshot is hidden when the snapshot is taken before JS can draw.

## Decisions

1. **The timeout is a security setting, so it's in the core** (ADR-0005):
   `getAutoLockTimeout` / `setAutoLockTimeout` in both cores, stored in secure storage next to
   the PIN (`autoLockMs`, decimal string). Default 60 s, accepted 0–60 min in whole ms (0 = lock
   every time the app leaves the foreground); anything else is INVALID_ARGUMENT. `resetAuth`
   resets it, `resetData` doesn't; a stored value this version can't read counts as the default.
   Same cases in both cores from `fixtures/pin.json` (`autoLock`).

2. **The lifecycle is UI** (`apps/mobile/src/features/auth/AuthGate.tsx`, `appLock.ts`): it reacts
   to `AppState`, which only React Native sees, and it's identical in both builds.
   - The timer starts at `background`. iOS's `inactive` (app switcher, Control Center, an
     incoming call) covers the app but doesn't start the timer.
   - **Time away = the larger of two clocks**: the wall clock (keeps counting while the phone
     sleeps, but can be set back by hand) and the monotonic clock (can't be set, but on Android
     stops while the phone sleeps). Setting the clock back alone can't skip a re-lock. A process
     killed in the background comes back through a cold start, which always locks.
   - The timeout is read from the core on every unlock and kept in memory, so the decision on
     return is synchronous. If it can't be read, the gate uses 0 (fail closed).
   - **Re-lock keeps the app mounted**: the unlock screen goes over it, and the app is
     non-interactive and hidden from screen readers meanwhile, so the screen and scroll position
     survive. Modals (the developer menu) are their own windows and are hidden while locked.
     "Forgot PIN" and "Reset onboarding" unmount it.

3. **Two covers.**
   - **JS cover** (`privacy-cover`): over the app as soon as `AppState` leaves `active`, lifted in
     the same render that decides whether to lock. Nothing flashes on return.
   - **Native snapshot protection**, because the snapshot is taken before JS can draw:
     Android 13+ `setRecentsScreenshotEnabled(false)` (screenshots stay allowed); older Android
     `FLAG_SECURE` while paused. Both live in `SecureWindow` (`@pocketly/native-secure-screen`),
     which also owns the PIN screens' `FLAG_SECURE`, so neither undoes the other. iOS: an opaque
     view over the window from `applicationWillResignActive` to `applicationDidBecomeActive`
     (`AppDelegate.swift`).

4. **Benchmarks** launch with `pocketly.skipLock=true` (perf builds only), so there's no gate, no
   re-lock and no JS cover; the native snapshot protection stays (it costs nothing measurable).

## Consequences

- iOS's snapshot cover and the capture cover haven't been run yet (written, not built).
- Re-lock needs no new bridge calls on the way back to the foreground; it adds one secure-storage
  read per unlock.
