# Pocketly — Product Document

> Working name. A portfolio e-wallet app built with React Native (UI) and Kotlin Multiplatform (shared core).

**Status:** Draft v0.2 · **Owner:** _you_ · **Last updated:** 2026-10-03

---

## 1. Vision

A fast, trustworthy mobile e-wallet that feels native on both iOS and Android. Its money logic is written once in Kotlin, tested heavily, and shared across platforms.

The app exists to show, in one project, that I can build:
- polished, smooth mobile UI (React Native)
- a correct, well-tested shared business core (Kotlin Multiplatform)
- fintech-grade handling of money, failures and security

## 2. Problem & Purpose

### 2.1 Portfolio problem
Many React Native portfolios show screens. Few show **correct state handling under failure** or **clean architecture boundaries**. Hiring managers at fintech companies look for:
- correct money handling (no floating-point errors, no double charges)
- honest handling of slow networks, timeouts and failures
- security awareness (secure storage, biometric gating)
- a codebase that's testable and easy to reason about

### 2.2 In-app user problem (the fictional product)
Users want to send money, pay merchants and check their balance quickly. They also need to trust the app, which means always knowing whether a payment went through.

## 3. Target Users

| Persona | Description | What they care about |
|---|---|---|
| **Rina, everyday user** (fictional) | 24, pays for coffee by QR, splits bills with friends | Speed, clarity, "did my payment go through?" |
| **Hiring manager / tech lead** (real audience) | Reviews the repo, README and demo video for 10–15 minutes | Architecture, correctness, tests, polish, decision-making |

The second persona is the one the project actually serves. Every feature should give them something to notice.

## 4. Goals & Non-Goals

### Goals
1. Ship a working e-wallet MVP on iOS and Android from one codebase.
2. Keep **100% of money and transaction logic in the KMP shared module**. React Native only renders state.
3. Handle every transaction outcome visibly: pending, success, failed, retry.
4. Reach smooth UI: 60fps scrolling and animations on a mid-range Android device.
5. Produce strong documentation: README, architecture diagram, decision records, demo video.

### Non-Goals
- Real money movement, real KYC or regulatory compliance
- Multi-currency, FX or international transfers
- A production backend (a simulated backend is enough; a real one is optional)
- Web or desktop versions
- Full trading features (order books, margin, etc.)

## 5. Feature Overview

Priority: **P0** = MVP, must ship · **P1** = should ship · **P2** = stretch

| # | Feature | Priority | Summary |
|---|---|---|---|
| F1 | Onboarding & Auth | P0 | Phone + OTP (mocked), create a 6-digit PIN, enable biometrics |
| F2 | App Lock | P0 | PIN/biometric unlock on launch and after a period in the background |
| F3 | Home & Balance | P0 | Balance card, hide/show balance, quick actions, recent transactions |
| F4 | Transaction History | P0 | Paginated, filterable list with offline cache and detail screen |
| F5 | P2P Transfer | P0 | Choose recipient → amount → review → PIN/biometric → result |
| F6 | Top-Up | P1 | Top up from a mocked payment method with a simulated delay |
| F7 | QR Pay | P1 | Scan a merchant QR code → parse → confirm → pay |
| F8 | My QR / Receive | P1 | Show a personal QR code others can scan to send money |
| F9 | Notifications | P1 | In-app notification when money arrives or a transfer resolves |
| F10 | Invest (Live Prices) | P2 | Watchlist of real live crypto or gold prices over WebSocket, with a chart |
| F11 | Developer Menu | P0 | Hidden menu to simulate a slow network, failures and offline mode |

> F11 is P0 because it's how reviewers see the failure handling in action, which is the core of the project.

## 6. Key User Flows

### 6.1 Send money (the flagship flow)
1. User taps **Send** on Home.
2. Picks a recent contact, or searches by phone number.
3. Enters an amount. The keypad blocks invalid input, and the app shows the remaining balance live.
4. Review screen shows the recipient, amount, fee (0) and an optional note.
5. User confirms with biometrics, or the PIN as fallback.
6. Processing screen appears (pending state), and the button can't be tapped twice.
7. Result screen shows:
   - **Success**: an animated check, transaction ID and a share-receipt option
   - **Failed**: a clear reason and a **Retry** button (same idempotency key)
   - **Still pending** after a timeout: "We'll notify you," and the transaction shows as pending in History until it resolves
8. Balance and History update. On success the update is optimistic; on failure it rolls back.

### 6.2 Pay by QR
Scan → app validates the merchant QR payload → shows merchant name and amount (editable if the QR is static) → confirm → same steps as 6.1 from step 5.

### 6.3 Cold start offline
User opens the app with no connection → unlocks with PIN → sees the cached balance and history with a "Last updated 10:32" label and an offline banner → any transfer they start is either blocked with a clear message, or queued (decision pending, see §11).

## 7. Navigation Structure

### 7.1 Bottom tab bar

The MVP ships with **4 tabs**. **Invest** is added as a 5th tab once F10 is built, so no empty tab appears in demos.

```
┌────────┬─────────┬─────────┬─────────┬─────────┐
│  Home  │ History │  (Pay)  │ Invest* │ Profile │
└────────┴─────────┴─────────┴─────────┴─────────┘
                       ▲ raised center button        * P2, hidden until F10 ships
```

| Tab | Contents | Rationale |
|---|---|---|
| **Home** | Balance card, quick actions (Send, Top-Up, Receive), recent transactions, notification bell (header) | Starting point for nearly every session |
| **History** | Full transaction list, filters, transaction detail | Checked often, especially for pending payments |
| **Pay** (center, raised) | Opens the QR scanner immediately | Most time-sensitive action: the user is at a counter |
| **Invest** (P2) | Watchlist, live prices, asset detail with chart | A self-contained section with its own navigation |
| **Profile** | Account info, My QR, security (PIN, biometrics, auto-lock), settings, app version (dev menu entry) | Groups everything that isn't about money |

### 7.2 Features outside the tab bar

| Feature | Entry point(s) | Presentation |
|---|---|---|
| Send (F5) | Home quick action, Contact in History detail | Stack flow → result screen → back to Home |
| Top-Up (F6) | Home quick action | Stack flow |
| Receive / My QR (F8) | Home quick action, Profile | Modal |
| Notifications (F9) | Bell icon on Home header (unread badge) | Stack screen |
| Developer Menu (F11) | Profile → tap app version 7× | Modal, debug/demo builds only |

Send, Top-Up and Receive are **flows** (enter, finish, leave), not destinations, so they don't need tabs.

### 7.3 Navigation rules

1. **Pay opens a full-screen modal**, not a tab screen. The camera runs only while the scanner is open, and dismissing it returns the user to the tab they were on.
2. **Money flows hide the tab bar** (Send, Top-Up, QR Pay, from amount entry to result) to keep focus and prevent leaving mid-transaction.
3. **After a result screen**, "Done" returns to Home (or the originating tab), and the flow's screens are removed from the back stack so Back can't re-open a completed payment.
4. **The lock screen sits above all navigation.** Re-locking (FR-LOCK-02) covers the current screen and keeps the user's place after unlocking.
5. **Tapping the active tab again** scrolls its list to the top (Home, History).

### 7.4 Navigator tree (React Navigation)

```
RootStack
├── LockScreen                        (shown above everything when locked)
├── OnboardingStack                   (until auth completes)
└── MainStack
    ├── Tabs
    │   ├── HomeStack      → Home, Notifications
    │   ├── HistoryStack   → History, TransactionDetail
    │   ├── PayTab         → (tab press opens QrScanner modal)
    │   ├── InvestStack*   → Watchlist, AssetDetail
    │   └── ProfileStack   → Profile, Security, Settings
    ├── SendFlow           → Recipient, Amount, Review, Processing, Result     (tab bar hidden)
    ├── TopUpFlow          → Amount, Method, Processing, Result               (tab bar hidden)
    ├── QrScanner          (modal) → QrConfirm, Processing, Result            (tab bar hidden)
    ├── MyQr               (modal)
    └── DevMenu            (modal, debug/demo only)
```

## 8. UX Principles

1. **The user always knows the state of their money.** No ambiguous spinners. Every state has a label.
2. **Prevent mistakes instead of explaining them.** Validate input as the user types and confirm before money moves.
3. **Fast feels trustworthy.** Use skeleton loaders, optimistic updates, haptics on success, and no layout shift.
4. **Security without friction.** Biometrics first, PIN as fallback, with automatic locking.
5. **Accessible by default.** Support dynamic type, screen-reader labels and sufficient contrast.

## 9. Tech Stack (summary)

| Layer | Choice |
|---|---|
| UI | React Native (New Architecture), TypeScript |
| Navigation | React Navigation |
| Animation / lists | Reanimated, Gesture Handler, FlashList |
| Bridge | Turbo Modules or reakt-native-toolkit (decision pending: check RN version compatibility) |
| Shared core | Kotlin Multiplatform: coroutines, Flow, kotlinx.serialization |
| Networking | Ktor client |
| Local storage | SQLDelight (cache), Keychain/Keystore via `expect`/`actual` (secrets) |
| DI | Koin |
| Backend | `FakeWalletApi` inside KMP (MVP) → optional Supabase later |
| Live prices | Public crypto market-data WebSocket (P2) |
| Testing | `commonTest` (Kotlin), Jest (TS), Maestro (end-to-end) |
| CI | GitHub Actions: lint, test, build both platforms |

## 10. Milestones

| Phase | Outcome | Exit criteria |
|---|---|---|
| **M1: Core** | KMP module with Money, Transaction state machine, FakeWalletApi | Unit tests pass, ≥90% coverage on `domain/` |
| **M2: Bridge** | RN app reads balance and history from Kotlin | Home and History render real data from the shared module on both platforms |
| **M3: Money moves** | Auth, App Lock, P2P Transfer with every outcome state | Transfer flow handles success, fail, timeout and retry; no double charge in tests |
| **M4: Payments** | Top-Up, QR Pay, My QR, Developer Menu | All P0 and P1 features are demoable |
| **M5: Polish** | Live prices (P2), animations, accessibility pass, docs | README, architecture diagram, ADRs and a 2–3 min demo video are published |

## 11. Risks & Open Questions

| Risk / Question | Impact | Mitigation / Next step |
|---|---|---|
| Bridging tool may not support my RN version or the New Architecture | High | Spike in M2 week 1; fall back to hand-written Turbo Modules |
| Kotlin learning curve slows M1 | Medium | Build M1 as a standalone library with tests before any RN work |
| iOS build friction (Kotlin/Native framework + CocoaPods/SPM) | Medium | Script the framework build; document it in the README |
| **Open:** Queue offline transfers, or block them? | Product | Lean toward **block with clear messaging** for the MVP; queueing is P2 |
| **Open:** Expo (dev build) or bare RN? | Tooling | Decide in the M2 spike |
| **Open:** Add a real Supabase backend? | Scope | Only after M5, if time allows |

## 12. Success Criteria (for the portfolio)

- A reviewer can clone, build and run the app on both platforms by following the README.
- The demo video shows a success, a failure, a retry and offline mode in under 3 minutes.
- The README explains **why** behind the key decisions, with at least 4 ADRs.
- Shared-module test coverage is ≥90% for `domain/` and ≥70% overall.
