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
export const PIN_SALT_BYTES = 16;
export const PIN_HASH_BYTES = 32;
/** Format version of the stored PIN record. */
export const PIN_RECORD_VERSION = 1;
/** FR-LOCK-04: this many wrong PINs in a row start a lockout. */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 5 * 60_000;
