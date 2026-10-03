/**
 * Mulberry32. Integer-only, so the Kotlin port (shared/.../data/fake/SeededRandom.kt)
 * produces the exact same sequence (BM-PAR-04).
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  nextUInt32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** In [0, bound). */
  nextInt(bound: number): number {
    return this.nextUInt32() % bound;
  }
}
