/**
 * The crypto primitives the PIN needs (ADR-0010). Native in both builds: the shipped app uses
 * react-native-quick-crypto (OpenSSL), tests use Node's crypto. Kotlin uses the platform's
 * (shared/.../security/PinCrypto.kt).
 */
export interface PinCrypto {
  /** From a cryptographically secure generator. */
  randomBytes(size: number): Uint8Array;
  /** PBKDF2-HMAC-SHA256. Must not run on the JS thread: the lock screen keeps animating meanwhile. */
  pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, keyLength: number): Promise<Uint8Array>;
  /** Constant-time comparison of two equal-length arrays. */
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
