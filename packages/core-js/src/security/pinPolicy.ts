import { PIN_LENGTH, PIN_RECORD_VERSION } from '@pocketly/core-contract';
import type { PinCheck } from '@pocketly/core-contract';

const DIGITS = /^[0-9]*$/;

/**
 * FR-AUTH-03. ASCII digits only (no full-width or other Unicode digits), exactly PIN_LENGTH,
 * and not trivial: all one digit, or a straight run up or down (123456, 987654).
 * Mirrors shared/.../security/PinPolicy.kt; cases in fixtures/pin.json.
 */
export function checkPin(pin: string): PinCheck {
  if (!DIGITS.test(pin)) return { ok: false, reason: 'NOT_DIGITS' };
  if (pin.length !== PIN_LENGTH) return { ok: false, reason: 'WRONG_LENGTH' };
  const step = pin.charCodeAt(1) - pin.charCodeAt(0);
  let straight = step >= -1 && step <= 1;
  for (let i = 2; straight && i < pin.length; i++) {
    straight = pin.charCodeAt(i) - pin.charCodeAt(i - 1) === step;
  }
  return straight ? { ok: false, reason: 'TOO_SIMPLE' } : { ok: true };
}

/** What secure storage holds for a PIN. Never the PIN itself (FR-AUTH-05). */
export interface PinRecord {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

const HEX = /^[0-9a-f]*$/;

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** `{"v":1,"iterations":…,"salt":"<hex>","hash":"<hex>"}`, key order fixed (fixtures/pin.json). */
export function encodePinRecord(record: PinRecord): string {
  return JSON.stringify({
    v: PIN_RECORD_VERSION,
    iterations: record.iterations,
    salt: toHex(record.salt),
    hash: toHex(record.hash),
  });
}

/** undefined for anything this version can't verify against. */
export function decodePinRecord(
  encoded: string,
  saltBytes: number,
  hashBytes: number,
): PinRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { v, iterations, salt, hash } = value as Record<string, unknown>;
  if (v !== PIN_RECORD_VERSION) return undefined;
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < 1) return undefined;
  if (typeof salt !== 'string' || salt.length !== saltBytes * 2 || !HEX.test(salt)) return undefined;
  if (typeof hash !== 'string' || hash.length !== hashBytes * 2 || !HEX.test(hash)) return undefined;
  return { iterations, salt: fromHex(salt), hash: fromHex(hash) };
}

/** The attempt counter (FR-LOCK-04), kept in secure storage so force-closing can't reset it. */
export interface LockoutState {
  failedAttempts: number;
  /** 0 = no lockout. */
  lockedUntil: number;
}

export function encodeLockout(state: LockoutState): string {
  return JSON.stringify({ failedAttempts: state.failedAttempts, lockedUntil: state.lockedUntil });
}

export function decodeLockout(encoded: string): LockoutState | undefined {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { failedAttempts, lockedUntil } = value as Record<string, unknown>;
  if (typeof failedAttempts !== 'number' || !Number.isInteger(failedAttempts) || failedAttempts < 0) return undefined;
  if (typeof lockedUntil !== 'number' || !Number.isInteger(lockedUntil) || lockedUntil < 0) return undefined;
  return { failedAttempts, lockedUntil };
}
