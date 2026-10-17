import { PHONE_COUNTRY_CODE } from '@pocketly/core-contract';

/** "8123456789" → "812-3456-789": 3 digits, then groups of 4 (Indonesian mobile style). */
export function groupNational(digits: string): string {
  const head = digits.slice(0, 3);
  const rest = digits.slice(3).match(/.{1,4}/g) ?? [];
  return [head, ...rest].filter((part) => part.length > 0).join('-');
}

/** "+6281234567890" → "+62 812-3456-7890". Other strings come back unchanged. */
export function formatPhone(e164: string): string {
  if (!e164.startsWith(PHONE_COUNTRY_CODE)) return e164;
  return `${PHONE_COUNTRY_CODE} ${groupNational(e164.slice(PHONE_COUNTRY_CODE.length))}`;
}
