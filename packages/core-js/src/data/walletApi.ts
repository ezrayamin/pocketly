import type { DatasetConfig, Transaction, Wallet } from '@pocketly/core-contract';

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
}

/** Developer-menu controls (FR-DEV-*). Only the fake backend implements this. */
export interface FakeBackendControls {
  /** FR-DEV-05: reset to a seeded state. */
  reset(config: DatasetConfig): Promise<void>;
  /** FR-DEV-04: the backend receives a deterministic incoming transfer, now. */
  simulateIncomingTransfer(): Promise<Transaction>;
}
