import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { BiometricPromptText } from '@pocketly/core-contract';
import type { BiometricSigner, SignResult, SignerHardware } from '../src/security/biometricSigner';

/**
 * A software P-256 key with scripted outcomes, for tests (ADR-0012). Mirrors
 * shared/src/jvmTest/.../security/FakeBiometricSigner.kt.
 */
export type NextScan = 'MATCH' | 'CANCEL' | 'LOCKOUT' | 'INVALIDATED' | 'DEVICE_LOCKED' | 'REPLAY' | 'OTHER_KEY';

export class FakeBiometricSigner implements BiometricSigner {
  hardwareState: SignerHardware = { available: true, kind: 'FINGERPRINT' };
  /** What the next scans do, in order; MATCH once the list is empty. */
  readonly scans: NextScan[] = [];
  /** Runs while the prompt is "open" (tests move the clock here). */
  duringPrompt: () => void = () => {};
  readonly prompts: BiometricPromptText[] = [];
  private key: KeyObject | undefined;
  private readonly other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  private lastSignature: Uint8Array | undefined;

  get hasKey(): boolean {
    return this.key !== undefined;
  }

  async hardware(): Promise<SignerHardware> {
    return this.hardwareState;
  }

  async createKey(): Promise<Uint8Array> {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.key = pair.privateKey;
    return new Uint8Array(pair.publicKey.export({ format: 'der', type: 'spki' }));
  }

  async sign(message: Uint8Array, prompt: BiometricPromptText): Promise<SignResult> {
    this.prompts.push(prompt);
    this.duringPrompt();
    const scan = this.scans.shift() ?? 'MATCH';
    if (scan === 'DEVICE_LOCKED') throw new Error('device locked');
    if (scan === 'CANCEL') return { kind: 'CANCELLED' };
    if (scan === 'LOCKOUT') return { kind: 'LOCKED_OUT' };
    if (scan === 'INVALIDATED' || this.key === undefined) return { kind: 'INVALIDATED' };
    if (scan === 'REPLAY') return { kind: 'SIGNED', signature: this.lastSignature ?? new Uint8Array([0]) };
    const key = scan === 'OTHER_KEY' ? this.other : this.key;
    const signature = new Uint8Array(sign('sha256', message, { key, dsaEncoding: 'der' }));
    if (scan === 'MATCH') this.lastSignature = signature;
    return { kind: 'SIGNED', signature };
  }

  async deleteKey(): Promise<void> {
    this.key = undefined;
  }
}
