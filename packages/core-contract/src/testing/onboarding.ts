/**
 * Tests only (ADR-0013): onboarding up to the PIN. setPin needs a phone verified by OTP first.
 * Uses Jest-free code, so app tests and the contract suite can share it.
 */
import { FAKE_OTP_CODE } from '../constants';
import type { Core } from '../core';

export const TEST_PHONE = '+6281234567890';

export async function verifyTestPhone(core: Core, phone: string = TEST_PHONE): Promise<void> {
  await core.requestOtp(phone);
  const result = await core.verifyOtp(phone, FAKE_OTP_CODE);
  if (result.outcome !== 'VERIFIED') throw new Error(`test phone not verified: ${result.outcome}`);
}
