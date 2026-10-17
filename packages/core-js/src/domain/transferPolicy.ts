import { CoreError, MAX_AMOUNT_MINOR, TRANSFER_MIN_MINOR, TRANSFER_NOTE_MAX_LENGTH } from '@pocketly/core-contract';
import type { AmountCheck, ErrorCode, MinorUnits } from '@pocketly/core-contract';

/**
 * Transfer rules (FR-TRF-02/03/08/10, ADR-0014). Pure functions, cases in
 * fixtures/transfer.json. Mirrors shared/.../domain/TransferPolicy.kt.
 */

export interface AmountLimits {
  balance: MinorUnits;
  /** Daily limit left today. */
  dailyRemaining: MinorUnits;
}

/** What the keypad can produce: a whole number without leading zeros, then up to 2 decimals. */
const KEYPAD_TEXT = /^(0|[1-9][0-9]*)(\.[0-9]{0,2})?$/;
const TOO_MANY_DECIMALS = /^(0|[1-9][0-9]*)\.[0-9]{3,}$/;
/** Whole digits of MAX_AMOUNT_MINOR (99,999,999,999.99). */
const MAX_WHOLE_DIGITS = 11;

/**
 * FR-TRF-02, on every keystroke. A trailing "." is accepted while typing. See
 * AmountCheck.acceptInput for which refusals the keypad drops.
 */
export function checkTransferAmount(text: string, limits: AmountLimits): AmountCheck {
  if (text.length === 0) return { ok: false, reason: 'EMPTY', acceptInput: true };
  if (text.startsWith('-')) return { ok: false, reason: 'NEGATIVE', acceptInput: false };
  if (TOO_MANY_DECIMALS.test(text)) return { ok: false, reason: 'TOO_MANY_DECIMALS', acceptInput: false };
  const match = KEYPAD_TEXT.exec(text);
  if (match === null) return { ok: false, reason: 'INVALID_FORMAT', acceptInput: false };
  const whole = match[1];
  if (whole.length > MAX_WHOLE_DIGITS) return { ok: false, reason: 'OUT_OF_RANGE', acceptInput: false };
  const fraction = (match[2] ?? '.').slice(1).padEnd(2, '0');
  const minor = Number(whole) * 100 + Number(fraction);
  if (minor > MAX_AMOUNT_MINOR) return { ok: false, reason: 'OUT_OF_RANGE', acceptInput: false };

  const remainingBalance = limits.balance - minor;
  if (minor < TRANSFER_MIN_MINOR) {
    return { ok: false, minor, reason: 'BELOW_MINIMUM', acceptInput: true, remainingBalance };
  }
  const reason = exceededLimit(minor, limits);
  if (reason !== undefined) return { ok: false, minor, reason, acceptInput: true, remainingBalance };
  return { ok: true, minor, acceptInput: true, remainingBalance };
}

/** min(balance, dailyRemaining). */
export function maxTransferAmount(limits: AmountLimits): MinorUnits {
  return Math.min(limits.balance, limits.dailyRemaining);
}

/** The bound an amount breaks: the balance first, then today's limit (the server's order too). */
export function exceededLimit(
  minor: MinorUnits,
  limits: AmountLimits,
): 'INSUFFICIENT_FUNDS' | 'DAILY_LIMIT_EXCEEDED' | undefined {
  if (minor > limits.balance) return 'INSUFFICIENT_FUNDS';
  if (minor > limits.dailyRemaining) return 'DAILY_LIMIT_EXCEEDED';
  return undefined;
}

/** A whole number of minor units a transfer may carry (the server checks this too). */
export function isValidTransferAmount(minor: number): boolean {
  return Number.isSafeInteger(minor) && minor >= TRANSFER_MIN_MINOR && minor <= MAX_AMOUNT_MINOR;
}

/**
 * FR-TRF-03: trimmed; empty means no note. Throws INVALID_ARGUMENT when too long or not one
 * line (the request the key protects must be unambiguous).
 */
export function normalizeNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined;
  const trimmed = note.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > TRANSFER_NOTE_MAX_LENGTH) {
    throw new CoreError('INVALID_ARGUMENT', `note must be at most ${TRANSFER_NOTE_MAX_LENGTH} characters`);
  }
  if (/[\r\n]/.test(trimmed)) throw new CoreError('INVALID_ARGUMENT', 'note must be one line');
  return trimmed;
}

/** requirements §4.3: may a FAILED transfer be sent again with the same key? */
export function isRetryable(code: ErrorCode): boolean {
  return code === 'NETWORK_UNAVAILABLE' || code === 'SERVER_ERROR' || code === 'NETWORK_TIMEOUT';
}
