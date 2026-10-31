import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  BiometricKind,
  BiometricPromptText,
  QrPaymentReview,
  TransferResult,
  TransferReview,
} from '@pocketly/core-contract';
import type { RootStackParamList } from '../../navigation';
import { biometricNoun } from '../auth/biometricCopy';

/**
 * An attempt that needs the user's approval (FR-TRF-04, FR-QR-04): a transfer or a QR payment.
 * Both go through the same PIN screen and the same confirmTransfer (ADR-0016 §1); only the words
 * and the result screen differ.
 */
export type Payment = { kind: 'TRANSFER'; review: TransferReview } | { kind: 'QR_PAYMENT'; review: QrPaymentReview };

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/** Who the money goes to. */
export function payee(payment: Payment): string {
  return payment.kind === 'TRANSFER' ? payment.review.recipient.name : payment.review.merchant.name;
}

/** "Sending $150.00" / "Paying $12.50", for the processing screen. `amount` is formatted by the core. */
export function processingTitle(payment: Payment, amount: string): string {
  return `${payment.kind === 'TRANSFER' ? 'Sending' : 'Paying'} ${amount}`;
}

/** The PIN screen's subtitle. */
export function pinSubtitle(payment: Payment, amount: string): string {
  return payment.kind === 'TRANSFER'
    ? `To send ${amount} to ${payee(payment)}.`
    : `To pay ${amount} to ${payee(payment)}.`;
}

/** The system prompt that signs this payment (ADR-0012). Its cancel button leads to the PIN. */
export function paymentPrompt(payment: Payment, kind: BiometricKind | undefined, amount: string): BiometricPromptText {
  const transfer = payment.kind === 'TRANSFER';
  return {
    title: transfer ? 'Confirm transfer' : 'Confirm payment',
    subtitle: `${transfer ? 'Send' : 'Pay'} ${amount} to ${payee(payment)} with your ${biometricNoun(kind)}`,
    cancel: 'Use PIN',
  };
}

/** The result replaces the flow in the back stack, so Back can't reopen a sent payment (product §7.3 rule 3). */
export function showResult(navigation: Navigation, payment: Payment, result: TransferResult): void {
  const route =
    payment.kind === 'TRANSFER'
      ? ({ name: 'SendResult', params: { review: payment.review, result } } as const)
      : ({ name: 'QrResult', params: { review: payment.review, result } } as const);
  navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, route] });
}
