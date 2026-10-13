import { CoreError } from '@pocketly/core-contract';

/**
 * The exact bytes the biometric key signs (ADR-0012, fixtures/biometric.json). Each kind starts
 * with its own versioned first line, so an unlock signature can never pass as a transfer
 * approval. Lines are joined with "\n"; no field may contain one. Mirrors
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

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}
