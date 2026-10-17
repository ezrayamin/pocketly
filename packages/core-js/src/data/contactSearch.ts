import { PHONE_COUNTRY_CODE } from '@pocketly/core-contract';
import type { Contact, PhoneLookup } from '@pocketly/core-contract';
import { checkPhone } from '../security/phonePolicy';

/**
 * FR-TRF-01 (ADR-0014): find contacts by name or phone. Cases in fixtures/transfer.json →
 * search. The fake server matches its directory with `matchDirectory`; the core adds what only
 * it knows (the user's own phone) with `searchDirectory`. Mirrors shared/.../data/ContactSearch.kt.
 */

const PHONE_LIKE = /^\+?[0-9 -]+$/;
const COUNTRY_DIGITS = PHONE_COUNTRY_CODE.slice(1);

/**
 * The national digits of a phone-like query, with one leading 0 dropped ("" matches everyone);
 * undefined when the query isn't phone-like; null for another country's number.
 */
function nationalDigits(query: string): string | null | undefined {
  if (!PHONE_LIKE.test(query)) return undefined;
  let digits = query.replace(/[^0-9]/g, '');
  if (query.startsWith('+')) {
    if (!digits.startsWith(COUNTRY_DIGITS)) return null;
    digits = digits.slice(COUNTRY_DIGITS.length);
  }
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

/** The E.164 number when the query is a complete phone number checkPhone accepts. */
export function queryPhone(query: string): string | undefined {
  const digits = nationalDigits(query.trim());
  if (digits === undefined || digits === null) return undefined;
  const check = checkPhone(digits);
  return check.ok ? check.e164 : undefined;
}

/** Contacts matching the query, sorted by name then id. An empty query matches everyone. */
export function matchDirectory(query: string, directory: readonly Contact[]): Contact[] {
  const q = query.trim();
  let matches: Contact[];
  if (q.length === 0) {
    matches = [...directory];
  } else {
    const digits = nationalDigits(q);
    if (digits === null) {
      matches = [];
    } else if (digits !== undefined) {
      matches = directory.filter((c) => c.phone.slice(PHONE_COUNTRY_CODE.length).includes(digits));
    } else {
      const needle = q.toLowerCase();
      matches = directory.filter((c) => c.name.toLowerCase().includes(needle));
    }
  }
  return matches.sort(byName);
}

/** What searchContacts returns, minus the recent list: never `selfPhone`, plus the lookup. */
export function searchDirectory(
  query: string,
  directory: readonly Contact[],
  selfPhone: string | undefined,
): { contacts: Contact[]; phoneLookup?: PhoneLookup } {
  const contacts = matchDirectory(query, directory).filter((c) => c.phone !== selfPhone);
  const phone = queryPhone(query);
  if (phone === undefined) return { contacts };
  if (phone === selfPhone) return { contacts, phoneLookup: 'SELF' };
  return { contacts, phoneLookup: contacts.some((c) => c.phone === phone) ? 'FOUND' : 'NOT_FOUND' };
}

function byName(a: Contact, b: Contact): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}
