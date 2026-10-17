# ADR-0013: Phone number and OTP onboarding

**Status:** Accepted · 2026-10-13 · Implements FR-AUTH-01/02 · Builds on ADR-0005, ADR-0010

## Context

Onboarding starts with the user's phone number and a 6-digit code sent by SMS (mocked). Until
now the app went straight to PIN creation, and "Forgot PIN" did too, so anyone holding an
unlocked phone could reset the PIN without proving anything.

## Decisions

1. **Indonesia (+62) mobile numbers only.** The national number starts with 8 and has 9–12
   digits; one typed leading 0 is dropped (people write 0812…); ASCII digits only. `checkPhone`
   returns the E.164 form (`+6281234567890`) or a reason (NOT_DIGITS, NOT_MOBILE, TOO_SHORT,
   TOO_LONG). Cases in `fixtures/phone.json`; both cores test against them.

2. **The OTP lives in the core and the fake backend**, because it's backend access and a security
   gate (ADR-0005). `WalletApi` gains `requestOtp` / `verifyOtp`, so they go through the timeout
   (NFR-REL-01) and the network simulation like every backend call. The fake server
   (`OtpServer`) behaves as a real one would:
   - the code is always `123456` (FR-AUTH-02); developer builds say so on the OTP screen;
   - 3 wrong codes in a row → a 30 s cooldown, **counted on the server**;
   - "Resend" only 30 s after the last code; a new code resets the wrong-code count but not a
     running cooldown; a code is valid for 5 minutes, and used up once verified;
   - it runs on the device clock (or a test clock), not the dataset's frozen one; memory only, so
     a restarted app needs a new code.

3. **No PIN without a verified phone, enforced in the core.** VERIFIED stores
   `{"phone","token","pinCreated"}` in secure storage (the token is the fake server's session).
   `setPin` rejects with NOT_FOUND until then. `getAuthState` reports the verified `phone`.
   `resetAuth` (logout, "Forgot PIN", reset onboarding) wipes it with the other secrets, so
   "Forgot PIN" goes through phone + OTP again.

4. **A session is only good while its PIN exists.** Once a PIN has been set from a session,
   losing the PIN record (unreadable, deleted) ends the session too. Otherwise a lost PIN record
   would let anyone set a new PIN without an OTP.

5. **Flow** (the gate): no verified phone → phone → OTP → PIN ("Step 1 of 2" when biometrics
   will be offered) → biometrics ("Step 2 of 2"); a PIN → unlock. The OTP screen blocks
   screenshots, like the PIN screens.

6. **Copy is accurate.** From the design mock: no "end-to-end encrypted" claim (the PIN is a
   salted PBKDF2 hash in Keystore/Keychain-protected storage), no requirement IDs in the UI, no
   platform-specific biometric names, no links to pages that don't exist yet (terms, privacy,
   FAQ).

## Consequences

- Tests that set a PIN verify a phone first (`verifyTestPhone`, in both cores).
- Installs from before this change have a PIN but no verified phone: they still unlock, and
  Profile shows "Phone not verified" until the next onboarding.
- A real backend replaces `OtpServer` behind `WalletApi`; the session token then authenticates
  backend calls, and the OTP rules move to the server where they belong.
