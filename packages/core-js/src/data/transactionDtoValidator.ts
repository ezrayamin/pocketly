import { MAX_AMOUNT_MINOR, isErrorCode } from '@pocketly/core-contract';
import type {
  Category,
  Counterparty,
  CounterpartyKind,
  IngestRejectReason,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@pocketly/core-contract';

/**
 * Validates one untrusted JSON value (NFR-REL-02: never crash on malformed data).
 * Rules run in a fixed order and the first failure wins.
 * Mirrors shared/.../data/TransactionDtoValidator.kt.
 */

const TYPES: readonly TransactionType[] = ['TRANSFER_OUT', 'TRANSFER_IN', 'TOP_UP', 'QR_PAYMENT'];
const STATUSES: readonly TransactionStatus[] = ['PENDING', 'SUCCESS', 'FAILED', 'REVERSED'];
const CATEGORIES: readonly Category[] = [
  'FOOD',
  'TRANSPORT',
  'SHOPPING',
  'BILLS',
  'ENTERTAINMENT',
  'TRANSFER',
  'TOP_UP',
];
const COUNTERPARTY_KINDS: readonly CounterpartyKind[] = ['USER', 'MERCHANT', 'PAYMENT_METHOD'];

export const MAX_ID_LENGTH = 64;
export const MAX_NOTE_LENGTH = 140;

export type ValidationResult =
  | { ok: true; value: Transaction }
  | { ok: false; reason: IngestRejectReason };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isOneOf = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === 'string' && (values as readonly string[]).includes(v);
const isTimestamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** JSON `null` and a missing key mean the same thing. */
const isAbsent = (v: unknown) => v === undefined || v === null;

function parseCounterparty(v: unknown): Counterparty | undefined | false {
  if (isAbsent(v)) {
    return undefined;
  }
  if (!isObject(v) || !isOneOf(v.kind, COUNTERPARTY_KINDS) || !isNonEmptyString(v.id) || !isNonEmptyString(v.name)) {
    return false;
  }
  if (!isAbsent(v.phone) && typeof v.phone !== 'string') {
    return false;
  }
  const counterparty: Counterparty = { kind: v.kind, id: v.id, name: v.name };
  if (typeof v.phone === 'string') {
    counterparty.phone = v.phone;
  }
  return counterparty;
}

export function validateTransaction(raw: unknown): ValidationResult {
  if (!isObject(raw)) {
    return { ok: false, reason: 'INVALID_SHAPE' };
  }
  if (!isId(raw.id) || !isId(raw.idempotencyKey)) {
    return { ok: false, reason: 'INVALID_ID' };
  }
  if (!isOneOf(raw.type, TYPES)) {
    return { ok: false, reason: 'INVALID_TYPE' };
  }
  if (!isOneOf(raw.category, CATEGORIES)) {
    return { ok: false, reason: 'INVALID_CATEGORY' };
  }
  const amount = raw.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_MINOR) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  if (!isOneOf(raw.status, STATUSES)) {
    return { ok: false, reason: 'INVALID_STATUS' };
  }
  const failed = raw.status === 'FAILED';
  if (failed ? !isErrorCode(raw.failureReason) : !isAbsent(raw.failureReason)) {
    return { ok: false, reason: 'INVALID_FAILURE_REASON' };
  }
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt) || raw.updatedAt < raw.createdAt) {
    return { ok: false, reason: 'INVALID_TIMESTAMP' };
  }
  const counterparty = parseCounterparty(raw.counterparty);
  if (counterparty === false) {
    return { ok: false, reason: 'INVALID_COUNTERPARTY' };
  }
  if (!isAbsent(raw.note) && (typeof raw.note !== 'string' || raw.note.length > MAX_NOTE_LENGTH)) {
    return { ok: false, reason: 'INVALID_NOTE' };
  }

  const tx: Transaction = {
    id: raw.id,
    idempotencyKey: raw.idempotencyKey,
    type: raw.type,
    category: raw.category,
    amount,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (counterparty !== undefined) {
    tx.counterparty = counterparty;
  }
  if (typeof raw.note === 'string') {
    tx.note = raw.note;
  }
  if (failed) {
    tx.failureReason = raw.failureReason as Transaction['failureReason'];
  }
  return { ok: true, value: tx };
}
