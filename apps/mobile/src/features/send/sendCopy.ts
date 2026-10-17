import type {
  AmountCheck,
  BiometricKind,
  BiometricPromptText,
  TransferAuthOutcome,
  TransferDraft,
  TransferResult,
} from '@pocketly/core-contract';
import { biometricNoun, capitalized } from '../auth/biometricCopy';
import { userErrorFor } from '../errors';

/**
 * Words for the Send flow (F5). Amounts arrive formatted by the core (NFR-ARCH-01): `fmt` is
 * core.formatMoney, passed in so this file stays free of the core and easy to test.
 */
type Fmt = (minor: number) => string;

/** The system prompt for confirming a transfer (ADR-0012). Its cancel button leads to the PIN. */
export function transferPrompt(
  kind: BiometricKind | undefined,
  amount: string,
  recipient: string,
): BiometricPromptText {
  return {
    title: 'Confirm transfer',
    subtitle: `Send ${amount} to ${recipient} with your ${biometricNoun(kind)}`,
    cancel: 'Use PIN',
  };
}

/**
 * FR-TRF-02/10: the line under the amount, or null when there's nothing to say. EMPTY and the
 * keystrokes the keypad already dropped never show anything.
 */
export function amountMessage(check: AmountCheck, draft: TransferDraft, fmt: Fmt): string | null {
  switch (check.reason) {
    case 'BELOW_MINIMUM':
      return check.minor === 0 ? null : `The smallest transfer is ${fmt(draft.minAmount)}.`;
    case 'INSUFFICIENT_FUNDS':
      return `That's more than your balance. You can send up to ${fmt(draft.maxAmount)}.`;
    case 'DAILY_LIMIT_EXCEEDED':
      return draft.maxAmount < draft.minAmount
        ? "You've reached today's transfer limit."
        : `That's over today's limit. You can send up to ${fmt(draft.maxAmount)} today.`;
    default:
      return null;
  }
}

/** "Send $1,650.00 instead": offered when the amount is over a limit and something can be sent. */
export function canOfferMax(check: AmountCheck, draft: TransferDraft): boolean {
  return (
    (check.reason === 'INSUFFICIENT_FUNDS' || check.reason === 'DAILY_LIMIT_EXCEEDED') &&
    draft.maxAmount >= draft.minAmount
  );
}

/** The PIN screen's line after a biometric attempt that didn't approve the transfer. null: nothing to explain. */
export function biometricFallbackNotice(
  outcome: TransferAuthOutcome,
  kind: BiometricKind | undefined,
): string | undefined {
  const noun = biometricNoun(kind);
  switch (outcome) {
    case 'BIOMETRIC_LOCKED_OUT':
      return `Too many ${noun} attempts. Use your PIN.`;
    case 'KEY_INVALIDATED':
      return `Your ${noun} settings changed, so ${noun} was turned off. Use your PIN.`;
    case 'FAILED':
      return "Couldn't confirm it's you. Use your PIN.";
    case 'UNAVAILABLE':
      return `${capitalized(noun)} isn't available right now. Use your PIN.`;
    default:
      return undefined;
  }
}

/** The result screen's heading and message (FR-TRF-07/08/09; requirements §4.3). */
export function resultCopy(result: TransferResult): { title: string; message: string } {
  switch (result.state) {
    case 'SUCCESS':
      return { title: 'Sent', message: '' };
    case 'PENDING':
      return { title: 'Still processing', message: userErrorFor('NETWORK_TIMEOUT').message };
    default:
      return {
        title: result.retryable ? "Transfer didn't go through" : 'Transfer declined',
        message: userErrorFor(result.failureReason ?? 'SERVER_ERROR').message,
      };
  }
}
