import { CoreError } from '@pocketly/core-contract';
import { BM10_MAX_ITERATIONS } from '@pocketly/core-contract/src/benchConstants';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const ASCII = /^[\x20-\x7e]*$/;
const HEX = /^(?:[0-9a-f]{2})*$/;

/**
 * BM-10 what-if (ADR-0010 §8): PBKDF2-HMAC-SHA256 in pure JS, never used by the PIN. It runs on
 * the JS thread: noble's async variant only yields to microtasks, so timers and rendering wait
 * until it's done. That stall is part of what BM-10 measures. Mirrors shared-bench/.../PurePbkdf2.kt.
 */
export async function purePbkdf2Sha256(password: string, saltHex: string, iterations: number): Promise<string> {
  if (!ASCII.test(password)) throw new CoreError('INVALID_ARGUMENT', 'password must be printable ASCII');
  if (!HEX.test(saltHex)) throw new CoreError('INVALID_ARGUMENT', 'salt must be lowercase hex');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > BM10_MAX_ITERATIONS) {
    throw new CoreError('INVALID_ARGUMENT', `iterations must be 1..${BM10_MAX_ITERATIONS}, got ${iterations}`);
  }
  const passwordBytes = Uint8Array.from(password, (c) => c.charCodeAt(0));
  return bytesToHex(await pbkdf2Async(sha256, passwordBytes, hexToBytes(saltHex), { c: iterations, dkLen: 32 }));
}
