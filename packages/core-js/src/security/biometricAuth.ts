import { BIOMETRIC_CHALLENGE_TTL_MS, BIOMETRIC_NONCE_BYTES, CoreError } from '@pocketly/core-contract';
import type {
  BiometricEnableResult,
  BiometricPromptText,
  BiometricStatus,
  BiometricUnlockResult,
  TransferAuthOutcome,
} from '@pocketly/core-contract';
import type { BiometricSigner, SignResult } from './biometricSigner';
import { type TransferApproval, transferMessage, unlockMessage, utf8 } from './biometricMessages';
import { SECURE_KEYS, type PinAuth } from './pinAuth';
import type { PinCrypto } from './pinCrypto';
import { toHex } from './pinPolicy';

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

interface Challenge {
  nonce: string;
  issuedAt: number;
}

/**
 * FR-AUTH-04 (ADR-0012). Biometric unlock = the biometric key signs a single-use challenge the
 * core just made, and the core verifies the signature with the public key it stored when
 * biometrics were enabled. On Android the scan unlocks the signing operation itself (the
 * Signature goes into BiometricPrompt as its CryptoObject), so a faked "success" callback can't
 * produce a signature. Mirrors shared/.../security/BiometricAuthenticator.kt.
 */
export class BiometricAuth {
  /** Challenges handed out and not yet answered. Memory only: a restart forgets them. */
  private readonly pending = new Map<string, Challenge>();

  constructor(
    private readonly pin: PinAuth,
    private readonly signer: BiometricSigner,
    private readonly crypto: PinCrypto,
    private readonly clock: () => number = Date.now,
  ) {}

  async status(): Promise<BiometricStatus> {
    const enabled = await this.pin.withStore(async (store) => (await store.get(SECURE_KEYS.biometricPublicKey)) !== undefined);
    const hw = await this.signer.hardware().catch(() => ({ available: false, reason: 'TEMPORARILY_UNAVAILABLE' as const }));
    return { ...hw, enabled };
  }

  async enable(pin: string, prompt: BiometricPromptText): Promise<BiometricEnableResult> {
    const hw = await this.signer.hardware().catch(() => undefined);
    if (hw === undefined || hw.reason === 'TEMPORARILY_UNAVAILABLE') return { outcome: 'UNAVAILABLE' };
    if (!hw.available) return { outcome: 'NOT_AVAILABLE' };
    // The PIN first: an unlocked phone left on a table mustn't be enough to turn biometrics on.
    const check = await this.pin.verifyPin(pin);
    if (check.outcome === 'WRONG_PIN') return { outcome: 'WRONG_PIN', attemptsLeft: check.attemptsLeft };
    if (check.outcome === 'LOCKED_OUT') return { outcome: 'PIN_LOCKED_OUT', lockedUntil: check.lockedUntil };

    let publicKey: Uint8Array;
    try {
      publicKey = await this.signer.createKey();
    } catch {
      return { outcome: 'UNAVAILABLE' };
    }
    // One scan to prove the key works for this user before turning anything on.
    const { message, result } = await this.signChallenge(prompt);
    if (result.kind === 'SIGNED' && this.answers(message.nonce, message.bytes, result.signature, publicKey)) {
      await this.pin.withStore((store) => store.set(SECURE_KEYS.biometricPublicKey, toHex(publicKey)));
      return { outcome: 'ENABLED' };
    }
    await this.signer.deleteKey().catch(() => undefined);
    if (result.kind === 'CANCELLED') return { outcome: 'CANCELLED' };
    if (result.kind === 'LOCKED_OUT') return { outcome: 'BIOMETRIC_LOCKED_OUT' };
    return { outcome: 'UNAVAILABLE' };
  }

  async disable(): Promise<void> {
    await this.pin.withStore(async (store) => {
      await this.signer.deleteKey().catch(() => undefined);
      await store.delete(SECURE_KEYS.biometricPublicKey);
    });
  }

  async unlock(prompt: BiometricPromptText): Promise<BiometricUnlockResult> {
    const stored = await this.pin.withStore((store) => store.get(SECURE_KEYS.biometricPublicKey));
    if (stored === undefined) throw new CoreError('NOT_FOUND', 'biometric unlock is not enabled');

    // The prompt runs outside the auth queue: it can take as long as the user likes.
    let signed: { message: { nonce: string; bytes: Uint8Array }; result: SignResult };
    try {
      signed = await this.signChallenge(prompt);
    } catch {
      return { outcome: 'UNAVAILABLE', pinLockedOut: false }; // temporary: nothing changes
    }
    const { message, result } = signed;
    if (result.kind === 'CANCELLED') return { outcome: 'CANCELLED', pinLockedOut: false };
    if (result.kind === 'LOCKED_OUT') return { outcome: 'BIOMETRIC_LOCKED_OUT', pinLockedOut: false };
    if (result.kind === 'INVALIDATED') {
      await this.disable(); // every permanent loss takes the same path: off, PIN, offer again
      return { outcome: 'KEY_INVALIDATED', pinLockedOut: false };
    }
    const challenge = this.pending.get(message.nonce);
    this.pending.delete(message.nonce);
    if (challenge === undefined || this.clock() - challenge.issuedAt > BIOMETRIC_CHALLENGE_TTL_MS) {
      return { outcome: 'FAILED', pinLockedOut: false }; // expired: a slow user, not an attack
    }
    if (!this.crypto.verifyP256(fromHex(stored), message.bytes, result.signature)) {
      await this.disable(); // a signature that doesn't verify can't be trusted to again
      return { outcome: 'FAILED', pinLockedOut: false };
    }
    // Never touches the PIN counter; a running lockout stays and the user is told about it.
    const pinLockedOut = await this.pin.withStore(() => this.pin.lockedOutNow());
    return { outcome: 'UNLOCKED', pinLockedOut };
  }

  /**
   * FR-TRF-04 (ADR-0012 §1, ADR-0014 §3): the biometric key signs this transfer's message
   * (amount, recipient, idempotency key) and the core verifies it. No challenge: the message
   * names one attempt, and sending that attempt again is idempotent anyway. Failures follow
   * unlock(): KEY_INVALIDATED and FAILED turn biometrics off; temporary ones change nothing.
   */
  async approveTransfer(approval: TransferApproval, prompt: BiometricPromptText): Promise<TransferAuthOutcome> {
    const stored = await this.pin.withStore((store) => store.get(SECURE_KEYS.biometricPublicKey));
    if (stored === undefined) throw new CoreError('NOT_FOUND', 'biometrics are not enabled');
    const bytes = utf8(transferMessage(approval));
    let result: SignResult;
    try {
      result = await this.signer.sign(bytes, prompt);
    } catch {
      return 'UNAVAILABLE';
    }
    if (result.kind === 'CANCELLED') return 'CANCELLED';
    if (result.kind === 'LOCKED_OUT') return 'BIOMETRIC_LOCKED_OUT';
    if (result.kind === 'INVALIDATED') {
      await this.disable();
      return 'KEY_INVALIDATED';
    }
    if (!this.crypto.verifyP256(fromHex(stored), bytes, result.signature)) {
      await this.disable();
      return 'FAILED';
    }
    return 'OK';
  }

  /** Logout / reset: the key goes with the other secrets. */
  async reset(): Promise<void> {
    await this.signer.deleteKey().catch(() => undefined);
    this.pending.clear();
    await this.pin.resetAuth();
  }

  private async signChallenge(prompt: BiometricPromptText) {
    const nonce = toHex(this.crypto.randomBytes(BIOMETRIC_NONCE_BYTES));
    this.pending.set(nonce, { nonce, issuedAt: this.clock() });
    const bytes = utf8(unlockMessage(nonce));
    try {
      const result = await this.signer.sign(bytes, prompt);
      return { message: { nonce, bytes }, result };
    } catch (e) {
      this.pending.delete(nonce);
      throw e;
    }
  }

  /** enable(): the confirming scan answered our challenge, in time, with the new key. */
  private answers(nonce: string, bytes: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    const challenge = this.pending.get(nonce);
    this.pending.delete(nonce);
    return (
      challenge !== undefined &&
      this.clock() - challenge.issuedAt <= BIOMETRIC_CHALLENGE_TTL_MS &&
      this.crypto.verifyP256(publicKey, bytes, signature)
    );
  }
}
