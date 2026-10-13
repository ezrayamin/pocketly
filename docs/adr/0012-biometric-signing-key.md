# ADR-0012: Biometrics as a signing key, in both cores

**Status:** Accepted · 2026-10-13 · Implements FR-AUTH-04 · Prepares FR-TRF-04 (slice 6) · Builds on ADR-0010

## Context

FR-AUTH-04 adds biometric unlock; FR-TRF-04 (slice 6) confirms transfers with biometrics. A
prompt that returns `true` proves little: on a rooted device the success callback can be faked.
Both cores need the same security properties, with jsCore going through a React Native library
and kmpCore through the platform APIs in Kotlin.

## Decisions

### 1. One primitive: a biometric-bound signing key

The core picks bytes, a key that only works right after a strong biometric scan signs them, and
the core verifies the signature with the public key it stored when biometrics were turned on.

| Use | What's signed | Verified by |
|---|---|---|
| App unlock (now) | A single-use challenge: `pocketly:unlock:v1\nnonce:<64 hex>` | The core |
| Transfer confirmation (slice 6) | `pocketly:transfer:v1\namount:<minor>\nrecipient:<id>\nidempotencyKey:<key>` | The core now; the server later |

**Why signing:** on Android the `Signature` goes into `BiometricPrompt` as its **CryptoObject**, so
the scan authorizes that one cryptographic operation. Intercepting the prompt's success callback
(possible on rooted devices) yields no signature, and a forged unlock fails verification. A plain
prompt without a crypto object can be bypassed that way. The full value arrives when a server
verifies transfer signatures; locally the design is already the right one, and the public key
can be registered with a real backend later.

**Kept apart:** each message kind starts with its own versioned first line, so an unlock
signature can never pass as a transfer approval. No field may contain a line break; amounts are
positive whole minor units (anything else is INVALID_ARGUMENT).

**Challenges** are 32 random bytes, kept in memory only, accepted once, and only within 60 s;
they're removed when checked. An answer to an old challenge (a replay) doesn't verify against the
new one. `fixtures/biometric.json` holds a key pair, both message formats, valid signatures and
rejected ones (tampered, another key, an unlock signature presented as a transfer, not DER);
generated with Node and checked with the openssl CLI; both cores test against it.

### 2. Key properties (the same in both builds)

| | kmpCore | jsCore (@sbaiahmed1/react-native-biometrics 0.16.1, pinned) |
|---|---|---|
| Android key | `AndroidBiometricSigner`: EC P-256, AndroidKeyStore, StrongBox if present else TEE | EC P-256, AndroidKeyStore, StrongBox if present else TEE |
| Android use | `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`: every signature, strong only | `setUserAuthenticationValidityDurationSeconds(-1)`: the same (biometric only, every use) |
| Android prompt | `BIOMETRIC_STRONG` only, Signature as CryptoObject | Allowed authenticators taken from the key (no `DEVICE_CREDENTIAL`), Signature as CryptoObject |
| Invalidation | `setInvalidatedByBiometricEnrollment(true)`; also by removing the screen lock | Platform default for such keys (true) |
| iOS key | `IosBiometricSigner`: Secure Enclave, `.biometryCurrentSet` + `.privateKeyUsage`, `WhenPasscodeSetThisDeviceOnly` | The same (`biometricStrength: 'strong'`, no device-credential fallback) |
| iOS policy | Biometrics only; the cancel button leads to our PIN | `.deviceOwnerAuthenticationWithBiometrics` |
| Signature | ECDSA-SHA256, DER; public key as SPKI DER | The same |

**Vetting the library** (checklist from the design review): signing goes through the prompt ✓;
per-use authentication ✓; no device-passcode fallback ✓ (`allowDeviceCredentials: false`,
`disableDeviceFallback: true`); invalidated on enrollment change ✓; distinguishable error codes:
cancel, lockout and iOS invalidation ✓, Android invalidation ✗ → patched
(`patches/@sbaiahmed1+react-native-biometrics+0.16.1.patch`, `docs/workarounds.md` #7). Its
logging is off by default and stays off. It's a 0.x library from one maintainer, so the version
is pinned; the alternatives were weaker (RSA keys outside the Secure Enclave) or a week old.

### 3. Behaviour

- **Turning it on** needs the PIN (checked by the core and counted like any attempt), then one
  confirming scan. Anything short of a verified signature leaves it off and deletes the key.
  Offered after the PIN is created, and in Profile → Security (which also turns it off).
- **The lock screen** asks for biometrics as soon as it appears (cold start and re-lock); "Use PIN"
  in the system prompt goes to the keypad, with a "Use fingerprint" link to try again.
- **During a PIN lockout** biometric unlock still works (a separate factor, which the OS
  rate-limits itself). It never touches the PIN counter; the app tells the user someone entered a
  wrong PIN 5 times.
- **Every permanent loss takes one path** — biometrics enrolled or removed, the screen lock or
  passcode removed (the key is deleted or invalidated), or a signature that doesn't verify:
  biometrics turn off, the PIN is required, and after a PIN unlock the app offers to turn them on
  again (with the PIN just entered).
- **Temporary failures** (device locked, sensor busy, no activity to show the prompt over) follow
  ADR-0010 §2.7: the key and the setting stay, and the lock screen falls back to the PIN.
- **An expired answer** (the user took more than 60 s) fails the unlock but leaves biometrics on.
- `resetAuth` (logout, "Forgot PIN", reset onboarding) deletes the key with the other secrets.

### 4. Linking (BM-08)

The jsCore library is a codegen Turbo Module, so on Android it stays in both flavors, like
quick-base64 (ADR-0010 §6), and pulls `androidx.biometric:1.4.0-alpha04`; kmpCore declares the
same version so one copy ships. On iOS it isn't linked when `CORE_IMPL=kmp`.

## Limits

- Locally the core verifies its own challenge; the property that matters most (a server checking
  a transfer signature against a registered public key) arrives with a real backend.
- iOS signers are written and compiled (Kotlin/Native) but not yet run on a device.
- Rooted devices can still read app memory; the signing key itself never leaves secure hardware.
