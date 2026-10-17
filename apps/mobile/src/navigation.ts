import type { Transaction, TransferDraft, TransferResult, TransferReview } from '@pocketly/core-contract';

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
  /** PIN fallback (FR-TRF-04). `notice`: why biometrics didn't do it. */
  SendPin: { review: TransferReview; notice?: string };
  SendResult: { review: TransferReview; result: TransferResult };
};
