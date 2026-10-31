import { CoreError } from '@pocketly/core-contract';

/**
 * The exact bytes the biometric key signs (ADR-0012, fixtures/biometric.json). Each kind starts
 * with its own versioned first line, so an unlock signature can never pass as a transfer
 * approval, nor a transfer's as a QR payment's (ADR-0016 §2). Lines are joined with "\n"; no field may contain one. Mirrors
 * shared/.../security/BiometricMessages.kt.
 */
const encoder = new TextEncoder();

export function unlockMessage(nonceHex: string): string {
  return `pocketly:unlock:v1\nnonce:${nonceHex}`;
}

export interface TransferApproval {
  /** Minor units, a positive whole number. */
  amount: number;
  recipientId: string;
  idempotencyKey: string;
}

/** Slice 6 (FR-TRF-04) signs this. Throws INVALID_ARGUMENT for values that can't be encoded unambiguously. */
export function transferMessage(t: TransferApproval): string {
  if (!Number.isSafeInteger(t.amount) || t.amount <= 0) {
    throw new CoreError('INVALID_ARGUMENT', 'transfer amount must be a positive whole number of minor units');
  }
  for (const [name, value] of [['recipientId', t.recipientId], ['idempotencyKey', t.idempotencyKey]] as const) {
    if (value.length === 0 || /[\r\n]/.test(value)) {
      throw new CoreError('INVALID_ARGUMENT', `transfer ${name} must be non-empty and on one line`);
    }
  }
  return `pocketly:transfer:v1\namount:${t.amount}\nrecipient:${t.recipientId}\nidempotencyKey:${t.idempotencyKey}`;
}

export interface QrPaymentApproval {
  /** Minor units, a positive whole number. */
  amount: number;
  merchantId: string;
  /** A dynamic code's payment request; absent for a static code (written as "-"). */
  requestId?: string;
  idempotencyKey: string;
}

/** ADR-0016 §2: a QR payment's approval. Throws INVALID_ARGUMENT for values that can't be encoded unambiguously. */
export function qrPaymentMessage(q: QrPaymentApproval): string {
  if (!Number.isSafeInteger(q.amount) || q.amount <= 0) {
    throw new CoreError('INVALID_ARGUMENT', 'QR payment amount must be a positive whole number of minor units');
  }
  const fields = [
    ['merchantId', q.merchantId],
    ['idempotencyKey', q.idempotencyKey],
    ...(q.requestId !== undefined ? [['requestId', q.requestId] as const] : []),
  ] as const;
  for (const [name, value] of fields) {
    if (value.length === 0 || /[\r\n]/.test(value) || value === '-') {
      throw new CoreError('INVALID_ARGUMENT', `QR payment ${name} must be non-empty, on one line and not "-"`);
    }
  }
  const request = q.requestId ?? '-';
  return `pocketly:qrpay:v1\namount:${q.amount}\nmerchant:${q.merchantId}\nrequest:${request}\nidempotencyKey:${q.idempotencyKey}`;
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}
