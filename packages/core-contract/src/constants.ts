import type { DatasetConfig, NetworkSimulation } from './types';

/** Largest amount either core accepts: 99,999,999,999.99. Well inside Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_MINOR = 9_999_999_999_999;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_INGEST_ERRORS = 20;
export const DEFAULT_PRICE_INTERVAL_MS = 100;

/** 2026-10-01T12:00:00Z */
export const DEFAULT_NOW_MILLIS = 1_790_856_000_000;

/** FR-FAKE-01: ~200 transactions over 60 days, frozen clock (tests, golden, benchmarks). */
export const DEFAULT_DATASET: DatasetConfig = {
  seed: 42,
  transactionCount: 200,
  nowMillis: DEFAULT_NOW_MILLIS,
};

/** Same data, but on the device clock: what the app uses. */
export const LIVE_DATASET: DatasetConfig = {
  seed: 42,
  transactionCount: 200,
};

/** NFR-REL-01: every backend read gives up after this long (→ NETWORK_TIMEOUT). */
export const READ_TIMEOUT_MS = 10_000;

/** FR-DEV-02 "slow": each call takes 2–5 s. */
export const SLOW_LATENCY_MIN_MS = 2_000;
export const SLOW_LATENCY_MAX_MS = 5_000;

/** The fake backend's default: no added latency, no failures (tests, benchmarks, app start). */
export const NETWORK_NORMAL: NetworkSimulation = { mode: 'NORMAL', failureRatePercent: 0 };

/** Default zone for "today" and month boundaries until the app calls setTimeZone. */
export const DEFAULT_TIME_ZONE = 'UTC';

// ── PIN (FR-AUTH-03/05, FR-LOCK-04; ADR-0010). Kotlin: shared/.../security/PinPolicy.kt ──

export const PIN_LENGTH = 6;
/**
 * PBKDF2-HMAC-SHA256 work factor, OWASP's 2023 figure. Identical in both cores
 * (fixtures/pin.json). Raising it later is safe: records carry their own count and are
 * re-hashed on the next successful unlock.
 */
export const PIN_PBKDF2_ITERATIONS = 600_000;
/** BM-10 (pbkdf2WhatIf): upper bound on iterations, so a typo can't hang the app for minutes. */
export const BM10_MAX_ITERATIONS = 1_000_000;
export const PIN_SALT_BYTES = 16;
export const PIN_HASH_BYTES = 32;
/** Format version of the stored PIN record. */
export const PIN_RECORD_VERSION = 1;
/** FR-LOCK-04: this many wrong PINs in a row start a lockout. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 5 * 60_000;

/** FR-LOCK-02: re-lock after this long in the background, unless changed (developer menu). */
export const DEFAULT_AUTO_LOCK_MS = 60_000;
/** Longest auto-lock timeout either core accepts. 0 = lock every time the app leaves the foreground. */
export const MAX_AUTO_LOCK_MS = 60 * 60_000;

// ── Phone + OTP (FR-AUTH-01/02; ADR-0013). Kotlin: shared/.../security/PhonePolicy.kt ──

export const PHONE_COUNTRY_CODE = '+62';
/** Indonesian mobile numbers: 8xx…, 9–12 digits after the country code. */
export const PHONE_MIN_DIGITS = 9;
export const PHONE_MAX_DIGITS = 12;
export const OTP_LENGTH = 6;
/** FR-AUTH-02: the fake server's code, always. */
export const FAKE_OTP_CODE = '123456';
/** FR-AUTH-02: this many wrong codes in a row start a cooldown. */
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_COOLDOWN_MS = 30_000;
/** FR-AUTH-02: "Resend" is allowed this long after the last code was sent. */
export const OTP_RESEND_MS = 30_000;
/** A code is valid this long after it was sent. */
export const OTP_TTL_MS = 5 * 60_000;

// ── Biometrics (ADR-0012). Kotlin: shared/.../security/BiometricPolicy.kt ──

/** A biometric unlock challenge must be signed within this long, once. */
export const BIOMETRIC_CHALLENGE_TTL_MS = 60_000;
export const BIOMETRIC_NONCE_BYTES = 32;
