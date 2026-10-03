import { CoreError, MAX_AMOUNT_MINOR } from '@pocketly/core-contract';
import type { MinorUnits, MoneyParseResult } from '@pocketly/core-contract';

/** Mirrors shared/.../domain/MoneyFormatter.kt. Keep the two algorithms identical (BM-PAR-02). */

export function assertMinor(value: number, field = 'amount'): MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new CoreError('INVALID_ARGUMENT', `${field} must be a safe integer of minor units, got ${value}`);
  }
  return value;
}

export function formatMoney(minor: MinorUnits): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = negative ? -minor : minor;
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;

  const digits = String(whole);
  let grouped = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      grouped += ',';
    }
    grouped += digits[i];
  }
  return `${negative ? '-' : ''}$${grouped}.${cents < 10 ? '0' : ''}${cents}`;
}

const AMOUNT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;
const MAX_WHOLE_DIGITS = 11;

export function parseMoney(input: string): MoneyParseResult {
  let s = input.trim();
  if (s.length === 0) {
    return { ok: false, error: 'EMPTY' };
  }
  if (s.startsWith('-')) {
    return { ok: false, error: 'NEGATIVE' };
  }
  if (s.startsWith('$')) {
    s = s.substring(1);
  }
  const match = AMOUNT_PATTERN.exec(s);
  if (match === null) {
    return { ok: false, error: 'INVALID_FORMAT' };
  }
  const fraction = match[2] ?? '';
  if (fraction.length > 2) {
    return { ok: false, error: 'TOO_MANY_DECIMALS' };
  }
  const whole = match[1].replace(/,/g, '').replace(/^0+(?=\d)/, '');
  if (whole.length > MAX_WHOLE_DIGITS) {
    return { ok: false, error: 'OUT_OF_RANGE' };
  }
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (minor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'OUT_OF_RANGE' };
  }
  return { ok: true, minor };
}
