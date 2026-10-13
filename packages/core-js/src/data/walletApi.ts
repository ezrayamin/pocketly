import type { DatasetConfig, OtpSendResult, OtpVerifyResult, Transaction, Wallet } from '@pocketly/core-contract';

/** What the server answers on an OTP check: the result, plus a session token when verified. */
export type ServerOtpVerify = OtpVerifyResult & { sessionToken?: string };

/** One page of server changes, ordered by (updatedAt, id). */
export interface ChangesPage {
  items: Transaction[];
  /** Pass back to continue after this page. */
  nextToken: string | undefined;
  hasMore: boolean;
}

/**
 * Backend boundary (requirements §4.1, NFR-ARCH-03). Swapping the fake for a real backend
 * only changes the wiring in `jsCore.ts`. History reads the local replica (ADR-0009), so the
 * backend exposes a change feed instead of paged history. Transfer/top-up/QR/events arrive
 * with M3/M4. Mirrors shared/.../data/WalletApi.kt.
 */
export interface WalletApi {
  getWallet(): Promise<Wallet>;
  /** Changes after `afterToken` (all, when undefined): the replica's delta sync. */
  getChanges(afterToken: string | undefined, limit: number): Promise<ChangesPage>;
  getTransaction(id: string): Promise<Transaction>;
  /** FR-AUTH-02 (ADR-0013): send a code by SMS. `phone` is E.164. */
  requestOtp(phone: string): Promise<OtpSendResult>;
  /** FR-AUTH-02: the server checks the code and counts wrong ones; VERIFIED carries a session token. */
  verifyOtp(phone: string, code: string): Promise<ServerOtpVerify>;
}

/** Developer-menu controls (FR-DEV-*). Only the fake backend implements this. */
export interface FakeBackendControls {
  /** FR-DEV-05: reset to a seeded state. */
  reset(config: DatasetConfig): Promise<void>;
  /** FR-DEV-04: the backend receives a deterministic incoming transfer, now. */
  simulateIncomingTransfer(): Promise<Transaction>;
}
