import { PHONE_COUNTRY_CODE, PHONE_MAX_DIGITS, PHONE_MIN_DIGITS } from '@pocketly/core-contract';
import type { PhoneCheck } from '@pocketly/core-contract';

const DIGITS = /^[0-9]*$/;

/**
 * FR-AUTH-01, Indonesia (+62) mobile numbers only (ADR-0013): ASCII digits; one typed leading 0
 * is dropped (people write 0812…); the national number starts with 8 and has 9–12 digits.
 * Mirrors shared/.../security/PhonePolicy.kt; cases in fixtures/phone.json.
 */
export function checkPhone(nationalNumber: string): PhoneCheck {
  if (!DIGITS.test(nationalNumber)) return { ok: false, reason: 'NOT_DIGITS' };
  const n = nationalNumber.startsWith('0') ? nationalNumber.slice(1) : nationalNumber;
  if (n.length === 0) return { ok: false, reason: 'TOO_SHORT' };
  if (n[0] !== '8') return { ok: false, reason: 'NOT_MOBILE' };
  if (n.length < PHONE_MIN_DIGITS) return { ok: false, reason: 'TOO_SHORT' };
  if (n.length > PHONE_MAX_DIGITS) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, e164: `${PHONE_COUNTRY_CODE}${n}` };
}

/** True for an E.164 number checkPhone would produce. */
export function isValidE164(phone: string): boolean {
  if (!phone.startsWith(PHONE_COUNTRY_CODE)) return false;
  const national = phone.slice(PHONE_COUNTRY_CODE.length);
  return !national.startsWith('0') && checkPhone(national).e164 === phone;
}
