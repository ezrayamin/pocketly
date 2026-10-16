# ADR-0010: The PIN and secure storage, in both cores

**Status:** Accepted · 2026-10-12 · Implements FR-AUTH-03/05, FR-LOCK-04, NFR-SEC-01/02 · Builds on ADR-0005

## Context

ADR-0005 puts security state in the core contract, so the PIN exists twice: in TypeScript
(jsCore) and in Kotlin (kmpCore). Both have to be equally secure. If they weren't, a benchmark
difference could come from one core doing less work, not from where the code runs. Each core
also needs its own secure storage: jsCore through a React Native library, kmpCore through the
platform APIs directly.

## Decisions

### 1. One PIN scheme, identical in both cores

| Parameter | Value |
|---|---|
| Algorithm | PBKDF2-HMAC-SHA256 over the PIN's ASCII bytes |
| Iterations | 600,000 (OWASP's figure). Unlock time on the slowest test phone is checked before slice 5 ships; if it drops, it drops in both cores |
| Salt | 16 bytes from the platform's secure generator, new for every `setPin` |
| Hash | 32 bytes |
| Stored record | `{"v":1,"iterations":600000,"salt":"<hex>","hash":"<hex>"}` (key order fixed) |
| Lockout | 5 wrong PINs in a row → 5 minutes; then a fresh set of 5 |

`packages/core-contract/fixtures/pin.json` holds the parameters, PBKDF2 vectors (computed with
Node and with Python's hashlib, which agree), the record byte for byte, unreadable records and
`checkPin` cases. Both cores test against it: jsCore with Node's crypto, kmpCore with javax.crypto
on the JVM and CommonCrypto on the iOS simulator (`shared/src/iosTest`). Each core also asserts
that its constants equal the fixture's.

`checkPin` refuses anything but six ASCII digits (full-width digits too), every PIN made of one
digit, and straight runs up or down (`123456`, `987654`).

### 2. How a PIN is checked

1. Calls run **one at a time** (a promise queue in TS, a `Mutex` in Kotlin), so two attempts
   can't both read the same counter.
2. If a lockout is running, the result is `LOCKED_OUT` and **the PIN isn't hashed at all**.
3. The attempt is **written to secure storage as wrong before hashing**, including the lockout
   it would start. Force-closing the app while it hashes can't undo the attempt. A correct PIN
   then resets the counter.
4. The hashes are compared in **constant time**: quick-crypto's `timingSafeEqual` (OpenSSL's
   `CRYPTO_memcmp`) in jsCore, an XOR-accumulate loop over every byte in kmpCore.
5. Hashing runs **off the JS thread**: quick-crypto's async `pbkdf2` runs on Nitro's thread
   pool, and kmpCore works on `Dispatchers.Default` (not the database thread other calls share).
6. A record with fewer iterations than the current figure is **re-hashed** with a new salt after
   a successful unlock, so the figure can go up later without breaking anyone's PIN.
7. **Fail closed, but wipe only on proof.** "Can't read" isn't "corrupt": both stores refuse
   access while the device is locked by design, and the app can run then (a notification, or iOS
   pre-launching it in the background before the user unlocks). So read failures come in two kinds:

   | Failure | Examples | Response |
   |---|---|---|
   | Temporarily unavailable | Device locked (`errSecInteractionNotAllowed`; Keystore "user not authenticated"), Keystore busy, any error a store throws | Reject with `SECURE_STORAGE_UNAVAILABLE`. Nothing is wiped and no attempt is counted; the lock screen stays locked and retries |
   | Permanently unreadable | Key invalidated or deleted, value tampered with, record present but unparsable | Wipe every secret; onboarding starts again |

   The store decides the first column: for a permanently unreadable value it deletes it and
   reports it absent; for anything else it throws, and the core turns every store exception into
   `SECURE_STORAGE_UNAVAILABLE` (`guarded` / `GuardedStore`). kmpCore's Android store also treats
   every failure as temporary while `KeyguardManager.isDeviceLocked`. The core wipes only on
   proof: a missing install id, or a PIN record that's present but can't be parsed.
   Tests (both cores, same cases): `secureStoreFailures.test.ts` / `SecureStoreFailuresTest.kt`,
   on a fake store that can be unavailable, fail chosen writes, or lose chosen keys.

   A counter that's unreadable, or missing while a PIN is set (`setPin` always writes one), reads
   as a lockout starting now.

The attempt counter and the lockout end live **in secure storage**, not in memory.

### 3. Secure storage per build

| | kmpCore | jsCore |
|---|---|---|
| Android | `AndroidSecureStore`: AES-256-GCM under its own non-exportable AndroidKeyStore key; ciphertext in SharedPreferences `pocketly.secure`; key name as AAD; written with `commit()` | react-native-sensitive-info 6.1.5, `accessControl: 'none'`: AES-256-GCM under an AndroidKeyStore key per service; ciphertext in SharedPreferences; written with `commit()` (patched) |
| iOS | `IosSecureStore`: generic-password Keychain items, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, updated in place | react-native-sensitive-info: generic-password Keychain items, `WhenUnlockedThisDeviceOnly` (patched) |
| PBKDF2 / random | javax.crypto `PBKDF2WithHmacSHA256`, which Android serves from BouncyCastle (Java on ART, logged once as `PocketlyCrypto`) · CommonCrypto + `SecRandomCopyBytes` | react-native-quick-crypto 1.1.7 (OpenSSL) |
| Service / namespace | `com.pocketly.secure` | `com.pocketly.secure` |

**Measured (quick check, 2026-10-12, vivo V2538, BM-11, 2 × 10 runs per build):** unlock takes
201 ms in jsCore and 554 ms in kmpCore (median), and the JS thread never stalls more than ~18 ms
in either. 600,000 iterations is acceptable on this phone for both. The gap is the PBKDF2
implementation, not KMP: Android's platform PBKDF2 is BouncyCastle in Java, quick-crypto's is
OpenSSL in C. Same pattern as SQLite in ADR-0009: the platform library, not the architecture.

**kmpCore keeps the platform PBKDF2.** It meets the rule (well under a second on the slowest
phone measured, lock screen responsive). The alternative, PBKDF2 as a loop over Android's native
`Mac("HmacSHA256")`, is unlikely to be clearly faster (BouncyCastle spends ~0.9 µs per iteration;
the loop would cross from Kotlin into native code several times per iteration) and would mean
writing PBKDF2 ourselves, which is hand-rolled crypto.

**Revisit if the median unlock exceeds 1 s on the low-end test phone** (the vivo is mid-range;
554 ms could become 1.5–2 s on a low-end one). In this order: (1) lower the iteration count in
both cores (records re-hash themselves, §2.6); (2) only then consider other approaches.

The PIN record isn't behind a biometric or passcode prompt in either build: the app has to read
it to check a PIN. Biometrics (step 4 of slice 5) protect a separate secret.

### 4. Does sensitive-info v6 give jsCore what kmpCore has?

| Property | kmpCore | jsCore, stock 6.1.5 | jsCore, as shipped |
|---|---|---|---|
| Hardware-backed keys where available | AndroidKeyStore key: in the TEE where the device has one, unlocked device required (API 28+, secure lock screen); iOS Keychain data-protection keys | Same on Android: AndroidKeyStore, unlocked device required. Neither uses StrongBox for non-biometric keys (slow; v6 keeps it for its biometric policy) | Same |
| iOS: readable only when unlocked | `WhenUnlocked…` | **No:** `AfterFirstUnlock`, readable while locked once unlocked after boot | **Yes** (patch) |
| iOS: this device only | `…ThisDeviceOnly` | **No:** can travel in an encrypted backup to another device | **Yes** (patch) |
| iOS: no iCloud Keychain sync | no `kSecAttrSynchronizable` | yes (`iosSynchronizable` defaults to false; we pass `false` explicitly) | Yes |
| Wiped on logout / "reset onboarding" | `resetAuth` → `clear()`: deletes the values and the Keystore key (`logout` clears the replica first, §7) | `resetAuth` → `clearService` | Yes |
| Wiped when the app is reinstalled | Android: yes (OS). iOS: **Keychain survives uninstall** → install marker, below | Same | Yes |
| The counter is on disk before hashing starts | `commit()` / `SecItemUpdate` | **No:** Android `apply()` writes asynchronously; iOS deletes then re-adds an item | **Yes**: `commit()` (patch); the iOS gap is covered by "missing counter fails closed" |

Gaps 2, 3 and the Android write are fixed by `patches/react-native-sensitive-info+6.1.5.patch`,
applied by the root `postinstall` (`scripts/apply-patches.js`, which uses the system `patch`, so
no extra dependency). It also covers v6's simulator fallback, which wrote `AfterFirstUnlock`.
The patch is listed in `docs/workarounds.md`. An install fails if a patch doesn't match the
installed version, so upgrading the library means re-checking this table.

### 5. Reinstalls and backups

- **Install marker.** The first auth call stores a random install id in the replica's
  `cache_meta` (deleted with the app) and in secure storage. The replica is in durable app
  storage, never a cache directory, so "Clear cache" can't remove the marker and trigger a wipe:
  Android `databases/` in both builds (`getDatabasePath`: SQLDelight's Android driver, op-sqlite);
  iOS `Library/Application Support/databases/` (kmpCore, SQLiter) and `Library/` (jsCore,
  op-sqlite), neither of which iOS purges. (Read from the libraries' sources, 2026-10-12.) If they differ, or the replica has
  none, everything in secure storage is from an earlier install and is wiped. `resetData`
  and `logout` clear the replica but keep the install id (`deleteSyncMeta`).
- **Android backups:** `allowBackup="false"` and `dataExtractionRules` that exclude everything
  from cloud backup and from device-to-device transfer (Android 12+ ignores `allowBackup` for
  the latter). Keystore keys never leave the device anyway; a value that can't be decrypted is
  deleted and reads as absent.
- **iOS backups:** `ThisDeviceOnly` items are never restored to another device.

### 6. Linking (BM-08)

sensitive-info and quick-crypto serve jsCore only. Their Android packages load their native
libraries as soon as they're created, so the op-sqlite approach (strip the `.so` from kmpCore)
would crash kmpCore at launch. Instead, as for core-kmp in ADR-0003 but the other way round,
Android autolinking is off for both, and the jsCore flavor links them by hand
(`jsCoreImplementation`, `CorePackages`). On iOS they aren't linked when `CORE_IMPL=kmp`.
**Known gap:** `react-native-quick-base64` (quick-crypto's required peer) is a codegen Turbo
Module in the app's generated C++ autolinking, so on Android it stays in both flavors, like the
Nitro runtime. BM-08 lists its size separately.

### 7. Logout (NFR-SEC-05)

`logout()` ends a session for good: Profile → "Log out", and "Forgot PIN" on the lock screen
(whoever onboards next must not see this history). `resetAuth` stays for the developer menu's
"Reset onboarding" and for BM-11, which keep the wallet data.

- **Order: the replica, then the secrets.** If secure storage then fails
  (SECURE_STORAGE_UNAVAILABLE), the history is already gone and the PIN still works: the user
  stays signed in and can retry. The other order could leave history behind a finished logout.
- **Work in flight can't refill it.** A sync or wallet fetch that was waiting on the server when
  logout ran would otherwise write its answer into the empty replica. The replica has a
  generation that `clear()` changes; sync and fetch compare it before each write and drop the
  answer if it changed (in kmpCore the writes don't suspend, so one check after the server call
  is enough; jsCore checks before each write, and `markSynced` is now one statement). Both
  cores test this with a 200 ms server (contract suite, `LogoutTest.kt`).
- **What stays:** the install id (§5), the fake server's data (it is the account), the network
  simulation and a staged BM-04b payload (developer and benchmark state, not user data).

### 8. jsCore keeps quick-crypto, OpenSSL included (decided 2026-10-16)

quick-crypto links OpenSSL 3.6.2 statically into `libQuickCrypto.so`: 9.35 MB stored in the
arm64 APK (native libraries are stored uncompressed), about 3.4 MB gzipped. Its symbols put
OpenSSL at ~83% of the library's code and data; the rest is quick-crypto, Nitro and libc++.
jsCore uses it for four jobs:

| Job | Needs native code? |
|---|---|
| PBKDF2 (§2) | Yes, for speed: 600,000 iterations |
| ECDSA P-256 verification (ADR-0012: biometric unlock now, transfers in slice 6) | Practically yes (a pure-JS verify is possible but slow and a new dependency) |
| Secure random bytes | No |
| Constant-time comparison | No |

**Considered: a small native module in jsCore that calls the platform's crypto** (javax.crypto /
`java.security.Signature` on Android, CommonCrypto / Security on iOS). Both cores would then use
the same crypto on each platform: OpenSSL would leave jsCore, BM-11 would lose its library gap
(unlock ~554 ms in both builds on the vivo, still under 1 s), and BM-08 would compare
architectures more cleanly. The cost: custom native code in jsCore for two jobs, on two
platforms, which is the kind of glue a typical React Native team avoids by taking a library.

**Chosen: keep quick-crypto.** It is what a React Native team would realistically ship, it needs
no crypto code of ours, and it is fast (201 ms unlock). The project measures architectures as
teams build them, and library choices are part of that, as op-sqlite is for storage (ADR-0009).
The price is that two results carry a library effect, so the report states it each time:

- **BM-08:** OpenSSL gets its own line. `apk-size.ts` keeps libQuickCrypto.so out of the
  "KMP architecture" row ("PIN crypto choice", next to the storage choice) and estimates
  OpenSSL's share of it from the release build's symbols. bundletool's download size covers the
  whole app, so for the library alone the script also records its gzipped size, an estimate of
  what it adds to the download.
- **BM-11:** jsCore is faster because of OpenSSL's C PBKDF2 against BouncyCastle in Java (§3),
  not because of the architecture. BM-10 measures the same work without the libraries.

**Revisit** if the download size of jsCore becomes a constraint, or if a platform's crypto
changes the comparison (e.g. a faster native PBKDF2 on Android). The native module above is the
fallback; nothing outside `quickCryptoPinCrypto()` would change, since the core only sees `PinCrypto`.

## Limits we accept

- **Lockouts use the device clock.** Moving the clock forward shortens a lockout. A monotonic,
  reboot-proof clock would need a server; when a real backend exists, it should enforce
  attempts too.
- **A six-digit PIN is a small space.** PBKDF2 slows an offline attack on a stolen record but
  can't stop one (10⁶ candidates). The real protection is that the record never leaves secure
  storage, and the lockout.
- **Rooted or jailbroken devices** are out of scope (no attestation).
- **sensitive-info deletes its key on `UnrecoverableKeyException`** (Android, before throwing
  "… Item must be recreated"), and jsCore can't intercept that. If an OEM keystore ever raised it
  for a locked device, jsCore would lose its secrets where kmpCore (which checks the lock state
  first) wouldn't. Not seen so far; the lock screen will offer "Forgot PIN" (re-onboarding) for
  any state the user can't get out of.
- **A permanent failure the store doesn't recognise looks temporary**, so the app stays locked
  instead of wiping. That's the safe direction; "Forgot PIN" is the way out.

## Later in slice 5 (planned, not built yet)

- **Biometrics (FR-AUTH-04, then FR-TRF-04 in slice 6): one shared module, designed for both
  uses now.** Unlocking the app: a biometric success releases a secret (a Keystore key or a
  Keychain item behind biometric access control), which proves the unlock. Confirming a
  transfer: a biometric-protected key **signs the transfer itself** (amount, recipient,
  idempotency key), so "the user approved this exact transfer" is a signature, not a `true`
  that any code could return.
- **Benchmarks vs the lock screen:** done in step 2. `pocketly.skipLock=true` (perf builds only)
  skips the gate; BM-01 moved to perf builds (benchmarking.md §5.3). Re-lock and the app-switcher
  cover: ADR-0011.
- **BM-10 (optional what-if, clearly labelled):** "the cost of keeping crypto in JS".
  @noble/hashes in jsCore against a pure-Kotlin PBKDF2 in kmpCore (not platform crypto), the
  same iteration count, identical hashes checked first. The shipped design stays as above.
