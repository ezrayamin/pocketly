import { TOP_UP_MAX_MINOR, TOP_UP_MIN_MINOR } from '@pocketly/core-contract';
import type { AmountCheck, Counterparty, TopUpMethod } from '@pocketly/core-contract';
import { parseKeypadAmount } from './transferPolicy';

/**
 * Top-up rules (FR-TOP-01/02, ADR-0015). Pure functions, cases in fixtures/topup.json.
 * Mirrors shared/.../domain/TopUpPolicy.kt.
 */

/** FR-TOP-02: each method's counterparty, the seed's PAYMENT_METHOD ones (seedData.ts). */
const METHODS: Readonly<Record<TopUpMethod, Counterparty>> = {
  BANK_TRANSFER: { kind: 'PAYMENT_METHOD', id: 'pm-bank', name: 'Bank transfer' },
  CARD: { kind: 'PAYMENT_METHOD', id: 'pm-card', name: 'Card' },
};

/** FR-TOP-01, on every keystroke: the keypad rules, then BELOW_MINIMUM, then ABOVE_MAXIMUM. */
export function checkTopUpAmount(text: string): AmountCheck {
  const parsed = parseKeypadAmount(text);
  if (typeof parsed !== 'number') return parsed;
  const minor = parsed;
  if (minor < TOP_UP_MIN_MINOR) return { ok: false, minor, reason: 'BELOW_MINIMUM', acceptInput: true };
  if (minor > TOP_UP_MAX_MINOR) return { ok: false, minor, reason: 'ABOVE_MAXIMUM', acceptInput: true };
  return { ok: true, minor, acceptInput: true };
}

/** A whole number of minor units a top-up may carry (the server checks this too). */
export function isValidTopUpAmount(minor: number): boolean {
  return Number.isSafeInteger(minor) && minor >= TOP_UP_MIN_MINOR && minor <= TOP_UP_MAX_MINOR;
}

export function isTopUpMethod(value: unknown): value is TopUpMethod {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(METHODS, value);
}

export function topUpCounterparty(method: TopUpMethod): Counterparty {
  return { ...METHODS[method] };
}

/** The method a top-up's counterparty stands for (an attempt rebuilt from the replica), if any. */
export function topUpMethodOf(counterparty: Counterparty | undefined): TopUpMethod | undefined {
  if (counterparty?.kind !== 'PAYMENT_METHOD') return undefined;
  return (Object.keys(METHODS) as TopUpMethod[]).find((m) => METHODS[m].id === counterparty.id);
}
