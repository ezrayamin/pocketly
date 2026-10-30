import { TOP_UP_MAX_MINOR, TOP_UP_MIN_MINOR } from '@pocketly/core-contract';
import type { AmountCheck, TopUpMethod, TransferResult } from '@pocketly/core-contract';
import { userErrorFor } from '../errors';

/**
 * Words for the Top-Up flow (F6, ADR-0015). As in sendCopy.ts, amounts arrive formatted by the
 * core: `fmt` is core.formatMoney, passed in so this file stays free of the core.
 */
type Fmt = (minor: number) => string;

/** FR-TOP-02: the mocked payment methods, as the user sees them. */
export const METHOD_COPY: Readonly<Record<TopUpMethod, { label: string; hint: string; approval: string }>> = {
  BANK_TRANSFER: {
    label: 'Bank transfer',
    hint: 'From your bank account',
    approval: 'Your bank approves the payment.',
  },
  CARD: { label: 'Card', hint: 'Debit or credit card', approval: 'Your card issuer approves the payment.' },
};

/** FR-TOP-01: the line under the amount, or null. EMPTY and a plain "0" say nothing. */
export function amountMessage(check: AmountCheck, fmt: Fmt): string | null {
  switch (check.reason) {
    case 'BELOW_MINIMUM':
      return check.minor === 0 ? null : `The smallest top-up is ${fmt(TOP_UP_MIN_MINOR)}.`;
    case 'ABOVE_MAXIMUM':
      return `You can top up at most ${fmt(TOP_UP_MAX_MINOR)} at a time.`;
    default:
      return null;
  }
}

/** The result screen's heading and message (FR-TOP-03, as FR-TRF-07/08/09). */
export function resultCopy(result: TransferResult): { title: string; message: string } {
  switch (result.state) {
    case 'SUCCESS':
      return { title: 'Money added', message: '' };
    case 'PENDING':
      return { title: 'Still processing', message: userErrorFor('NETWORK_TIMEOUT').message };
    default:
      return {
        title: result.retryable ? "Top-up didn't go through" : 'Top-up declined',
        message: userErrorFor(result.failureReason ?? 'SERVER_ERROR').message,
      };
  }
}
