import type { ErrorCode, StaleInfo } from '@pocketly/core-contract';
import { toCoreError } from '@pocketly/core-contract';

/** User-facing copy per error code (requirements §4.3). */
const MESSAGES: Record<ErrorCode, string> = {
  INSUFFICIENT_FUNDS: "Your balance isn't enough for this transfer.",
  DAILY_LIMIT_EXCEEDED: "You've reached today's transfer limit.",
  RECIPIENT_NOT_FOUND: "We couldn't find this recipient.",
  INVALID_QR: "This isn't a valid payment code.",
  NETWORK_TIMEOUT: "This is taking longer than usual. We'll let you know when it's done.",
  NETWORK_UNAVAILABLE: "You're offline. Check your connection and try again.",
  SERVER_ERROR: 'Something went wrong on our side. Please try again.',
  IDEMPOTENCY_CONFLICT: 'Something went wrong. Please start a new transfer.',
  NOT_FOUND: "We couldn't find that.",
  INVALID_ARGUMENT: 'Something went wrong. Please try again.',
  SECURE_STORAGE_UNAVAILABLE: 'Unlock your phone, then try again.',
};

export interface UserError {
  code: ErrorCode;
  message: string;
  offline: boolean;
}

export function userErrorFor(code: ErrorCode): UserError {
  return { code, message: MESSAGES[code], offline: code === 'NETWORK_UNAVAILABLE' };
}

export function toUserError(error: unknown): UserError {
  return userErrorFor(toCoreError(error).code);
}

/** Why cached data is on screen (FR-HIST-04): the failure the core fell back from. */
export function staleNotice(stale: StaleInfo): UserError {
  return userErrorFor(stale.reason);
}
