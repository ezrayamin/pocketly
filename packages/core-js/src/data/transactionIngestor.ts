import { CoreError, MAX_INGEST_ERRORS } from '@pocketly/core-contract';
import type { IngestError, IngestResult, Transaction } from '@pocketly/core-contract';
import { validateTransaction } from './transactionDtoValidator';
import type { TransactionStore } from './transactionStore';

/**
 * BM-04: JSON → validate → write. Mirrors shared/.../data/TransactionIngestor.kt.
 * Both sides parse into a generic tree first, then validate field by field.
 */
export function ingestTransactions(json: string, store: TransactionStore): IngestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CoreError('INVALID_ARGUMENT', 'Payload is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new CoreError('INVALID_ARGUMENT', 'Payload must be a JSON array');
  }

  const accepted: Transaction[] = [];
  const seen = new Set<string>();
  const errors: IngestError[] = [];
  let rejected = 0;
  let duplicates = 0;

  for (let index = 0; index < parsed.length; index++) {
    const result = validateTransaction(parsed[index]);
    if (!result.ok) {
      rejected++;
      if (errors.length < MAX_INGEST_ERRORS) {
        errors.push({ index, reason: result.reason });
      }
      continue;
    }
    const id = result.value.id;
    if (seen.has(id) || store.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    accepted.push(result.value);
  }

  store.insertAll(accepted);
  return { accepted: accepted.length, rejected, duplicates, errors };
}
