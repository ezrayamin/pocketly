import { QR_MAX_LENGTH } from '@pocketly/core-contract';
import type { QrCode, QrKind } from '@pocketly/core-contract';

/**
 * QR codes (FR-QR-02, ADR-0016 §3): strict parsing of `pocketly://pay/v1?m=…[&r=…]` and
 * `pocketly://user/v1?u=…`. Total: every input gets a QrCode, nothing throws (NFR-REL-02). Cases
 * in fixtures/qr.json. Mirrors shared/.../domain/QrPolicy.kt.
 */

/** Merchant, payment request and user ids. Nothing in a code needs percent-decoding. */
export const QR_ID = /^[A-Za-z0-9-]{1,32}$/;
const HEAD = /^pocketly:\/\/([a-z]+)\//;
const VERSION = /^v([0-9]+)\?/;
const PAIR = /^([a-z]+)=(.*)$/;

const KINDS: ReadonlyMap<string, { kind: QrKind; required: readonly string[]; optional: readonly string[] }> = new Map([
  ['pay', { kind: 'MERCHANT', required: ['m'], optional: ['r'] }],
  ['user', { kind: 'USER', required: ['u'], optional: [] }],
]);

const MALFORMED: QrCode = { ok: false, reason: 'MALFORMED' };

export function parseQr(text: string): QrCode {
  if (text.length > QR_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  const head = HEAD.exec(text);
  if (head === null) return MALFORMED;
  const spec = KINDS.get(head[1]);
  if (spec === undefined) return { ok: false, reason: 'UNKNOWN_KIND' };
  const rest = text.slice(head[0].length);
  const version = VERSION.exec(rest);
  if (version === null) return MALFORMED;
  if (version[1] !== '1') return { ok: false, reason: 'UNSUPPORTED_VERSION' };

  const params = new Map<string, string>();
  for (const pair of rest.slice(version[0].length).split('&')) {
    const match = PAIR.exec(pair);
    if (match === null) return MALFORMED;
    const [, name, value] = match;
    const known = spec.required.includes(name) || spec.optional.includes(name);
    if (!known || params.has(name) || !QR_ID.test(value)) return MALFORMED;
    params.set(name, value);
  }
  if (!spec.required.every((name) => params.has(name))) return MALFORMED;

  if (spec.kind === 'USER') return { ok: true, kind: 'USER', userId: params.get('u')! };
  const requestId = params.get('r');
  return {
    ok: true,
    kind: 'MERCHANT',
    merchantId: params.get('m')!,
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

/** F8: the code My QR shows for this account's user id. */
export function userQrPayload(userId: string): string {
  return `pocketly://user/v1?u=${userId}`;
}
