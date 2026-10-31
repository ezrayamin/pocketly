import type { HybridObject } from 'react-native-nitro-modules';
// NFR-ARCH-05: struct/enum types are NOT redeclared here. Nitrogen resolves them from
// the contract package, so core-contract/src/types.ts stays the single source of truth.
import type {
  AmountCheck,
  AppNotification,
  AuthState,
  BiometricEnableResult,
  BiometricPromptText,
  BiometricStatus,
  BiometricUnlockResult,
  ContactSearch,
  DatasetSeed,
  MoneyParseResult,
  NetworkSimulation,
  NotificationList,
  OtpSendResult,
  OtpVerifyResult,
  PhoneCheck,
  PinCheck,
  PriceTick,
  QrCode,
  QrPaymentDraft,
  QrPaymentReview,
  SpendingSummary,
  TopUpMethod,
  TopUpReview,
  Transaction,
  TransactionPage,
  TransferAuth,
  TransferDraft,
  TransferResult,
  TransferReview,
  TxFilter,
  UnlockResult,
  Wallet,
} from '@pocketly/core-contract';

type Platforms = { ios: 'swift'; android: 'kotlin' };

/** A live price stream. Dropping it (or calling unsubscribe) cancels the Kotlin Flow. */
export interface PriceSubscription extends HybridObject<Platforms> {
  unsubscribe(): void;
}

/** F9 (ADR-0017): new notifications. Unsubscribing stops delivery, not the core's catching up. */
export interface NotificationSubscription extends HybridObject<Platforms> {
  unsubscribe(): void;
}

/**
 * The Kotlin Multiplatform core, as seen from JS. Implemented by
 * `HybridPocketlyCore` (android/…/HybridPocketlyCore.kt, ios/HybridPocketlyCore.swift),
 * which are thin adapters over `shared/…/bridge/PocketlyCore`.
 *
 * `src/index.ts` adapts this to the `Core` contract.
 */
export interface PocketlyCore extends HybridObject<Platforms> {
  resetData(config: DatasetSeed): Promise<void>;
  getWallet(): Promise<Wallet>;
  getTransactions(cursor: string | undefined, limit: number, filter: TxFilter | undefined): Promise<TransactionPage>;
  getTransaction(id: string): Promise<Transaction>;

  setNetworkSimulation(simulation: NetworkSimulation): void;
  getNetworkSimulation(): NetworkSimulation;
  simulateIncomingTransfer(): Promise<Transaction>;

  setTimeZone(zoneId: string): void;

  computeSpendingSummary(month: string): Promise<SpendingSummary>;

  checkPin(pin: string): PinCheck;
  setPin(pin: string): Promise<void>;
  verifyPin(pin: string): Promise<UnlockResult>;
  getAuthState(): Promise<AuthState>;
  resetAuth(): Promise<void>;
  logout(): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  setAutoLockTimeout(ms: number): Promise<void>;
  checkPhone(nationalNumber: string): PhoneCheck;
  requestOtp(phone: string): Promise<OtpSendResult>;
  verifyOtp(phone: string, code: string): Promise<OtpVerifyResult>;
  getBiometricStatus(): Promise<BiometricStatus>;
  enableBiometrics(pin: string, prompt: BiometricPromptText): Promise<BiometricEnableResult>;
  disableBiometrics(): Promise<void>;
  unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlockResult>;

  // F5 (ADR-0014). Seven methods, kept coarse (ADR-0002): one struct per answer.
  searchContacts(query: string): Promise<ContactSearch>;
  startTransfer(recipientId: string): Promise<TransferDraft>;
  checkTransferAmount(text: string): AmountCheck;
  reviewTransfer(amount: number, note: string | undefined): Promise<TransferReview>;
  confirmTransfer(id: string, auth: TransferAuth | undefined): Promise<TransferResult>;
  getTransferStatus(id: string): Promise<TransferResult>;
  setDailyLimit(minor: number): Promise<void>;

  // F6 (ADR-0015). Two methods; confirming and checking reuse confirmTransfer / getTransferStatus.
  // Not `method`: Nitro's generated JNI code has a local of that name.
  checkTopUpAmount(text: string): AmountCheck;
  reviewTopUp(amount: number, paymentMethod: TopUpMethod): Promise<TopUpReview>;

  // F7, F8 (ADR-0016). Four methods; confirming and checking reuse confirmTransfer / getTransferStatus.
  parseQr(text: string): QrCode;
  startQrPayment(merchantId: string, requestId: string | undefined): Promise<QrPaymentDraft>;
  reviewQrPayment(amount: number): Promise<QrPaymentReview>;
  getMyQr(): Promise<string>;

  // F9 (ADR-0017). Three methods: a stream (a callback plus a subscription, as subscribePrices), the list, read.
  subscribeNotifications(onNew: (notifications: AppNotification[]) => void): NotificationSubscription;
  getNotifications(): Promise<NotificationList>;
  markNotificationsRead(): Promise<void>;

  formatMoney(minor: number): string;
  parseMoney(input: string): MoneyParseResult;

  subscribePrices(
    symbols: string[],
    intervalMs: number,
    seed: number,
    onTicks: (ticks: PriceTick[]) => void,
  ): PriceSubscription;
}
