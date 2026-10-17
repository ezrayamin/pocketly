import type { ErrorCode } from './types';

const ERROR_CODES: readonly ErrorCode[] = [
  'INSUFFICIENT_FUNDS',
  'DAILY_LIMIT_EXCEEDED',
  'RECIPIENT_NOT_FOUND',
  'INVALID_QR',
  'NETWORK_TIMEOUT',
  'NETWORK_UNAVAILABLE',
  'SERVER_ERROR',
  'IDEMPOTENCY_CONFLICT',
  'NOT_FOUND',
  'INVALID_ARGUMENT',
  'SECURE_STORAGE_UNAVAILABLE',
];

export class CoreError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'CoreError';
    this.code = code;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Native errors cross the bridge as plain `Error`s. The Kotlin side encodes the code
 * as a `[CODE] message` prefix (see `shared/.../bridge/BridgeError.kt`), and this decodes it.
 */
export function toCoreError(error: unknown): CoreError {
  if (error instanceof CoreError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /\[([A-Z_]+)\]\s*(.*)/s.exec(message);
  if (match && isErrorCode(match[1])) {
    return new CoreError(match[1], match[2]);
  }
  return new CoreError('SERVER_ERROR', message);
}
