import { pbkdf2, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import type { PinCrypto } from '../src/security/pinCrypto';

/** Node's crypto (OpenSSL, libuv thread pool): the PinCrypto for Jest and scripts. */
export const nodePinCrypto: PinCrypto = {
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
  pbkdf2Sha256: (password, salt, iterations, keyLength) =>
    new Promise((resolve, reject) => {
      pbkdf2(password, salt, iterations, keyLength, 'sha256', (error, key) => {
        if (error) reject(error);
        else resolve(new Uint8Array(key));
      });
    }),
  timingSafeEqual: (a, b) => timingSafeEqual(a, b),
  verifyP256: (publicKey, message, signature) => {
    try {
      return verify('sha256', message, { key: Buffer.from(publicKey), format: 'der', type: 'spki', dsaEncoding: 'der' }, signature);
    } catch {
      return false;
    }
  },
};
