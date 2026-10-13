import type { BiometricKind, BiometricPromptText, BiometricUnlockOutcome } from '@pocketly/core-contract';

export function capitalized(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** "fingerprint", "face" or "biometrics": what the user calls the sensor. */
export function biometricNoun(kind: BiometricKind | undefined): string {
  if (kind === 'FINGERPRINT') return 'fingerprint';
  if (kind === 'FACE') return 'face';
  return 'biometrics';
}

export function unlockPrompt(kind: BiometricKind | undefined): BiometricPromptText {
  return { title: 'Unlock Pocketly', subtitle: `Use your ${biometricNoun(kind)}`, cancel: 'Use PIN' };
}

export function enablePrompt(kind: BiometricKind | undefined): BiometricPromptText {
  return { title: `Turn on ${biometricNoun(kind)} unlock`, subtitle: `Confirm with your ${biometricNoun(kind)}`, cancel: 'Cancel' };
}

/** What the lock screen says after a biometric attempt that didn't unlock. null: just show the keypad. */
export function biometricUnlockMessage(outcome: BiometricUnlockOutcome, kind: BiometricKind | undefined): string | null {
  const noun = biometricNoun(kind);
  switch (outcome) {
    case 'CANCELLED':
    case 'UNLOCKED':
      return null;
    case 'BIOMETRIC_LOCKED_OUT':
      return `Too many ${noun} attempts. Use your PIN.`;
    case 'KEY_INVALIDATED':
      return `Your ${noun} settings changed, so ${noun} unlock was turned off. Use your PIN.`;
    case 'FAILED':
      return "Couldn't confirm it's you. Use your PIN.";
    case 'UNAVAILABLE':
      return `${capitalized(noun)} isn't available right now. Use your PIN.`;
  }
}

/** After a biometric unlock during a PIN lockout (ADR-0012). */
export const WRONG_PINS_NOTICE =
  "Someone entered a wrong PIN 5 times. If that wasn't you, someone may have tried to open your wallet.";
