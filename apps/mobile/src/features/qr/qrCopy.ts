import type { ErrorCode, TransferResult } from '@pocketly/core-contract';
import { userErrorFor } from '../errors';

/** Words for QR Pay and My QR (F7, F8, ADR-0016). Amounts arrive formatted by the core. */

/** Why a scanned code can't be paid, by the core's error code; anything else uses errors.ts. */
export function scanProblem(code: ErrorCode): string {
  switch (code) {
    case 'INVALID_QR':
      return userErrorFor('INVALID_QR').message;
    case 'INSUFFICIENT_FUNDS':
      return "Your balance isn't enough to pay this code.";
    case 'DAILY_LIMIT_EXCEEDED':
      return "Paying this code would go over today's limit.";
    case 'INVALID_ARGUMENT':
      return "That's your own code. Show it to someone who's paying you.";
    case 'RECIPIENT_NOT_FOUND':
      return "We couldn't find this person on Pocketly.";
    default:
      return userErrorFor(code).message;
  }
}

/** The result screen's heading and message (FR-QR-04: as FR-TRF-07/08/09). */
export function resultCopy(result: TransferResult): { title: string; message: string } {
  switch (result.state) {
    case 'SUCCESS':
      return { title: 'Paid', message: '' };
    case 'PENDING':
      return { title: 'Still processing', message: userErrorFor('NETWORK_TIMEOUT').message };
    default:
      return {
        title: result.retryable ? "Payment didn't go through" : 'Payment declined',
        message: userErrorFor(result.failureReason ?? 'SERVER_ERROR').message,
      };
  }
}
