import { PIN_LENGTH } from '@pocketly/core-contract';
import type { PinRejectReason } from '@pocketly/core-contract';

/** FR-AUTH-03: why a new PIN was refused, in words. Never repeats the PIN. */
export const PIN_REJECTED: Record<PinRejectReason, string> = {
  TOO_SIMPLE: 'Too simple: avoid repeated or sequential digits.',
  NOT_DIGITS: 'Use digits only.',
  WRONG_LENGTH: `Use ${PIN_LENGTH} digits.`,
};

export const PIN_MISMATCH = "The PINs didn't match. Choose your PIN again.";

/** FR-LOCK-04. */
export function wrongPinMessage(attemptsLeft: number): string {
  return `Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`;
}

/** 4:05, for the lockout countdown. Rounds up, so it never shows 0:00 while still locked. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Screen readers hear how many digits are in, never which. */
export function digitsEnteredLabel(count: number, length = PIN_LENGTH): string {
  return `${count} of ${length} digits entered`;
}
