import {
  FAKE_OTP_CODE,
  OTP_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
} from '@pocketly/core-contract';
import type { OtpSendResult } from '@pocketly/core-contract';
import type { ServerOtpVerify } from '../walletApi';

interface Pending {
  sentAt: number;
  failed: number;
  cooldownUntil: number;
  /** False once used or replaced: the next verify needs a new code. */
  live: boolean;
}

/**
 * The fake server's OTP side (FR-AUTH-02, ADR-0013). The code is always FAKE_OTP_CODE; the
 * server counts wrong codes per phone (OTP_MAX_ATTEMPTS → OTP_COOLDOWN_MS cooldown), refuses a
 * resend within OTP_RESEND_MS and expires codes after OTP_TTL_MS, as a real backend would. It
 * runs on the device clock (or a test clock), not the dataset's frozen one. Memory only: a
 * restarted app needs a new code. Mirrors shared/.../data/fake/OtpServer.kt.
 */
export class OtpServer {
  private readonly pending = new Map<string, Pending>();
  private issued = 0;

  constructor(private readonly clock: () => number) {}

  send(phone: string): OtpSendResult {
    const now = this.clock();
    const current = this.pending.get(phone);
    if (current !== undefined && now - current.sentAt < OTP_RESEND_MS) {
      return { outcome: 'TOO_SOON', resendAt: current.sentAt + OTP_RESEND_MS };
    }
    // A new code: wrong attempts start over, a running cooldown doesn't.
    this.pending.set(phone, { sentAt: now, failed: 0, cooldownUntil: current?.cooldownUntil ?? 0, live: true });
    return { outcome: 'SENT', resendAt: now + OTP_RESEND_MS };
  }

  verify(phone: string, code: string): ServerOtpVerify {
    const now = this.clock();
    const p = this.pending.get(phone);
    if (p === undefined || !p.live) return { outcome: 'NO_CODE' };
    if (p.cooldownUntil > now) return { outcome: 'COOLDOWN', retryAt: p.cooldownUntil };
    if (now - p.sentAt > OTP_TTL_MS) {
      p.live = false;
      return { outcome: 'EXPIRED' };
    }
    if (code !== FAKE_OTP_CODE) {
      p.failed += 1;
      if (p.failed >= OTP_MAX_ATTEMPTS) {
        p.failed = 0;
        p.cooldownUntil = now + OTP_COOLDOWN_MS;
        return { outcome: 'COOLDOWN', retryAt: p.cooldownUntil };
      }
      return { outcome: 'WRONG_CODE', attemptsLeft: OTP_MAX_ATTEMPTS - p.failed };
    }
    p.live = false;
    this.issued += 1;
    return { outcome: 'VERIFIED', sessionToken: `fake-session-${this.issued}-${now}` };
  }
}
