import { PIN_LENGTH, PIN_LOCKOUT_MS, PIN_MAX_ATTEMPTS } from '@pocketly/core-contract';
import type { PinRejectReason } from '@pocketly/core-contract';

/** FR-AUTH-03: why a new PIN was refused, in words. Never repeats the PIN. */
export const PIN_REJECTED: Record<PinRejectReason, string> = {
  TOO_SIMPLE: 'Too simple: avoid repeated or sequential digits.',
  NOT_DIGITS: 'Use digits only.',
  WRONG_LENGTH: `Use ${PIN_LENGTH} digits.`,
};

export const PIN_MISMATCH = "The PINs didn't match. Choose your PIN again.";

/** FR-LOCK-04: the card after a wrong PIN. "Final attempt" when one is left. */
export function wrongPinNotice(attemptsLeft: number): { text: string; detail: string; badge?: string } {
  const minutes = PIN_LOCKOUT_MS / 60_000;
  return {
    text: `Wrong PIN entered (${PIN_MAX_ATTEMPTS - attemptsLeft}/${PIN_MAX_ATTEMPTS})`,
    detail: `${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left before a ${minutes}-minute security lockout.`,
    badge: attemptsLeft === 1 ? 'Final attempt' : undefined,
  };
}

/** FR-LOCK-04: the card during a lockout, with the live countdown. */
export function lockoutNotice(remainingMs: number): { text: string; detail: string; badge: string } {
  return { text: 'Too many wrong PINs', detail: `Try again in ${formatCountdown(remainingMs)}.`, badge: 'Locked' };
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
