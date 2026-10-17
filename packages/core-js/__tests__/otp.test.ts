import { FAKE_OTP_CODE, OTP_COOLDOWN_MS, OTP_RESEND_MS, OTP_TTL_MS } from '@pocketly/core-contract';
import type { Core } from '@pocketly/core-contract';
import { TEST_PHONE as PHONE } from '@pocketly/core-contract/src/testing/onboarding';
import { testCore } from '../testing/testCore';

/** FR-AUTH-02 timing on a test clock (ADR-0013). Same cases as shared/src/jvmTest/.../contract/OtpTest.kt. */
describe('OTP timing', () => {
  let now: number;
  let core: Core;

  beforeEach(() => {
    now = 1_790_856_000_000;
    core = testCore({ clock: () => now, pinIterations: 1000 });
  });

  it('allows a resend OTP_RESEND_MS after the last code', async () => {
    const first = await core.requestOtp(PHONE);
    expect(first).toEqual({ outcome: 'SENT', resendAt: now + OTP_RESEND_MS });
    now += OTP_RESEND_MS - 1;
    expect((await core.requestOtp(PHONE)).outcome).toBe('TOO_SOON');
    now += 1;
    expect(await core.requestOtp(PHONE)).toEqual({ outcome: 'SENT', resendAt: now + OTP_RESEND_MS });
  });

  it('a cooldown ends after OTP_COOLDOWN_MS; then the right code verifies', async () => {
    await core.requestOtp(PHONE);
    for (let i = 0; i < 3; i++) await core.verifyOtp(PHONE, '000000');
    now += OTP_COOLDOWN_MS - 1;
    expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'COOLDOWN', retryAt: now + 1 });
    now += 1;
    expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'VERIFIED' });
  });

  it('a new code starts the wrong-attempt count over', async () => {
    await core.requestOtp(PHONE);
    await core.verifyOtp(PHONE, '000000');
    await core.verifyOtp(PHONE, '000000');
    now += OTP_RESEND_MS;
    await core.requestOtp(PHONE);
    expect(await core.verifyOtp(PHONE, '000000')).toEqual({ outcome: 'WRONG_CODE', attemptsLeft: 2 });
  });

  it('a new code doesn\'t end a running cooldown', async () => {
    await core.requestOtp(PHONE); // t = 0
    now += 20_000;
    for (let i = 0; i < 3; i++) await core.verifyOtp(PHONE, '000000'); // cooldown until t = 50 s
    now += OTP_RESEND_MS - 20_000; // t = 30 s: a resend is allowed, the cooldown still runs
    expect((await core.requestOtp(PHONE)).outcome).toBe('SENT');
    expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'COOLDOWN', retryAt: now + 20_000 });
  });

  it('a code expires after OTP_TTL_MS', async () => {
    await core.requestOtp(PHONE);
    now += OTP_TTL_MS + 1;
    expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'EXPIRED' });
    expect(await core.verifyOtp(PHONE, FAKE_OTP_CODE)).toEqual({ outcome: 'NO_CODE' });
  });

  it('OTP calls go through the network simulation (offline → NETWORK_UNAVAILABLE)', async () => {
    core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    await expect(core.requestOtp(PHONE)).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
  });
});
