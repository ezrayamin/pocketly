import type { DatasetConfig } from './types';

/** Largest amount either core accepts: 99,999,999,999.99. Well inside Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_MINOR = 9_999_999_999_999;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_INGEST_ERRORS = 20;
export const DEFAULT_PRICE_INTERVAL_MS = 100;

/** 2026-10-01T12:00:00Z */
export const DEFAULT_NOW_MILLIS = 1_790_856_000_000;

/** FR-FAKE-01: ~200 transactions over 60 days. */
export const DEFAULT_DATASET: DatasetConfig = {
  seed: 42,
  transactionCount: 200,
  nowMillis: DEFAULT_NOW_MILLIS,
};
