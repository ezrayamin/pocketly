import { CoreError, MAX_INGEST_ERRORS } from '@pocketly/core-contract';
import type { IngestError, Transaction } from '@pocketly/core-contract';
import { validateTransaction } from './transactionDtoValidator';

export interface ParsedIngest {
  /** Valid entries in input order (duplicates included: the write step drops them). */
  valid: Transaction[];
  rejected: number;
  errors: IngestError[];
}

/**
 * BM-04 compute step: JSON → generic tree → field-by-field validation. The write step is
 * CacheStore.insertIfAbsentMany (storage, timed separately: ADR-0009).
 * Mirrors shared/.../data/TransactionIngestor.kt.
 */
export function parseAndValidate(json: string): ParsedIngest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CoreError('INVALID_ARGUMENT', 'Payload is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new CoreError('INVALID_ARGUMENT', 'Payload must be a JSON array');
  }

  const valid: Transaction[] = [];
  const errors: IngestError[] = [];
  let rejected = 0;
  for (let index = 0; index < parsed.length; index++) {
    const result = validateTransaction(parsed[index]);
    if (result.ok) {
      valid.push(result.value);
    } else {
      rejected++;
      if (errors.length < MAX_INGEST_ERRORS) errors.push({ index, reason: result.reason });
    }
  }
  return { valid, rejected, errors };
}
