import type {
  QrPaymentDraft,
  QrPaymentReview,
  TopUpReview,
  Transaction,
  TransferDraft,
  TransferResult,
  TransferReview,
} from '@pocketly/core-contract';
import type { Payment } from './features/send/payment';

/**
 * Root stack (product.md §7.4, the part built so far): the tab screens, with
 * TransactionDetail pushed above them. Detail lives here rather than in a per-tab stack
 * because the tabs are a custom bar, not a tab navigator: a stack inside a hidden tab
 * would still take Android's Back press.
 */
export type RootStackParamList = {
  Tabs: undefined;
  /** `tx` paints the screen at once; the screen then re-reads it by id (status may have moved). */
  TransactionDetail: { id: string; tx?: Transaction };
  /** Profile → Security: PIN, then one scan, to turn biometric unlock on (FR-AUTH-04). */
  BiometricSetup: undefined;
  // Send flow (F5, product §6.1). Root-stack screens, so the tab bar is hidden (§7.3 rule 2).
  // Params are the core's own answers; the core keeps the attempt (its key) itself.
  SendRecipient: undefined;
  SendAmount: { draft: TransferDraft };
  SendReview: { review: TransferReview };
  /** PIN fallback (FR-TRF-04, FR-QR-04), for a transfer or a QR payment. `notice`: why biometrics didn't do it. */
  SendPin: { payment: Payment; notice?: string };
  SendResult: { review: TransferReview; result: TransferResult };
  // Top-Up flow (F6, ADR-0015 §5): amount → method → review → result, root-stack screens too.
  TopUpAmount: undefined;
  /** `amount`: what the amount step accepted (checkTopUpAmount), in minor units. */
  TopUpMethod: { amount: number };
  TopUpReview: { review: TopUpReview };
  TopUpResult: { review: TopUpReview; result: TransferResult };
  // QR Pay (F7, ADR-0016): the platform's scanner, then amount (static codes) → review → PIN → result.
  /** `code`: a payload handed in by a dev link (ADR-0008) instead of the camera. */
  QrScan: { code?: string } | undefined;
  QrAmount: { draft: QrPaymentDraft };
  QrReview: { review: QrPaymentReview };
  QrResult: { review: QrPaymentReview; result: TransferResult };
  /** F8: this account's code, as a modal (product §7.4). */
  MyQr: undefined;
  /** F9 (FR-NOTIF-03): the bell's list; opening it marks all read. */
  Notifications: undefined;
};
