import type { PriceTick } from '@pocketly/core-contract';
import { SeededRandom } from '../data/random';

/**
 * Deterministic simulated price feed (BM-05). The real WebSocket feed (F10) will sit
 * behind the same shape. Mirrors shared/.../sync/PriceFeed.kt.
 */

const BASE_PRICES: Readonly<Record<string, number>> = {
  BTC: 6_500_000,
  ETH: 350_000,
  SOL: 15_000,
  XAU: 240_000,
  XAG: 3_000,
};
const DEFAULT_BASE_PRICE = 10_000;
const MAX_STEP_BPS = 50;

export class PriceFeed {
  private readonly rng: SeededRandom;
  private readonly prices: number[];
  private seq = 0;

  constructor(
    private readonly symbols: readonly string[],
    seed: number,
  ) {
    this.rng = new SeededRandom(seed);
    this.prices = symbols.map((s) => BASE_PRICES[s] ?? DEFAULT_BASE_PRICE);
  }

  step(): PriceTick[] {
    this.seq++;
    const ticks: PriceTick[] = [];
    for (let i = 0; i < this.symbols.length; i++) {
      const bps = this.rng.nextInt(2 * MAX_STEP_BPS + 1) - MAX_STEP_BPS;
      const price = this.prices[i];
      const next = Math.max(1, price + Math.trunc((price * bps) / 10_000));
      this.prices[i] = next;
      ticks.push({ symbol: this.symbols[i], price: next, changeBps: bps, seq: this.seq });
    }
    return ticks;
  }
}
