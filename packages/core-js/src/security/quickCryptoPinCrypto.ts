import { pbkdf2, randomBytes, timingSafeEqual } from 'react-native-quick-crypto';
import type { PinCrypto } from './pinCrypto';

/**
 * jsCore's PIN crypto (ADR-0010): react-native-quick-crypto (OpenSSL). The async pbkdf2 runs on
 * Nitro's thread pool, so the JS thread stays free while a PIN is checked.
 */
export function quickCryptoPinCrypto(): PinCrypto {
  return {
    randomBytes: (size) => new Uint8Array(randomBytes(size)),
    pbkdf2Sha256: (password, salt, iterations, keyLength) =>
      new Promise((resolve, reject) => {
        pbkdf2(password, salt, iterations, keyLength, 'sha256', (error, key) => {
          if (error || !key) reject(error ?? new Error('pbkdf2 returned nothing'));
          else resolve(new Uint8Array(key));
        });
      }),
    timingSafeEqual: (a, b) => timingSafeEqual(a, b),
  };
}
