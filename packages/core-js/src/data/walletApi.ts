import type { DatasetConfig, Transaction, TransactionPage, TxFilter, Wallet } from '@pocketly/core-contract';

/**
 * Backend boundary (requirements §4.1, NFR-ARCH-03). Swapping the fake for a real
 * backend only changes the wiring in `jsCore.ts`. The transfer/top-up/QR/event
 * methods arrive with M3/M4. Mirrors shared/.../data/WalletApi.kt.
 */
export interface WalletApi {
  getWallet(): Promise<Wallet>;
  getTransactions(cursor: string | undefined, limit: number, filter?: TxFilter): Promise<TransactionPage>;
  getTransaction(id: string): Promise<Transaction>;
}

/** Developer-menu controls (FR-DEV-*). Only the fake backend implements this. */
export interface FakeBackendControls {
  /** FR-DEV-05: reset to a seeded state. */
  reset(config: DatasetConfig): void;
}
