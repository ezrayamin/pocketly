import {
  DEFAULT_DATASET,
  PENDING_RESOLVE_MAX_MS,
  QR_MAX_LENGTH,
  TRANSFER_FEE_MINOR,
  TRANSFER_MIN_MINOR,
} from '@pocketly/core-contract';
import type { ErrorCode, Transaction } from '@pocketly/core-contract';
import fixture from '@pocketly/core-contract/fixtures/qr.json';
import { FakeWalletApi } from '../src/data/fake/fakeWalletApi';
import { ServerStore } from '../src/data/fake/serverStore';
import { MERCHANTS, seedPaymentRequests } from '../src/data/seedData';
import { UserTimeZone } from '../src/data/timeZone';
import { parseQr, userQrPayload } from '../src/domain/qrPolicy';
import { nodeSqliteDriver } from '../testing/nodeSqliteDriver';

/** ADR-0016: the QR rules and the fake server's merchant endpoints, against fixtures/qr.json. */

const NOW = DEFAULT_DATASET.nowMillis!;

async function openServer(otpNow = { ms: 0 }): Promise<FakeWalletApi> {
  const api = new FakeWalletApi(
    new ServerStore(nodeSqliteDriver()),
    () => new UserTimeZone('UTC'),
    () => otpNow.ms,
  );
  await api.open(DEFAULT_DATASET);
  return api;
}

async function error(promise: Promise<unknown>): Promise<ErrorCode | undefined> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return (e as { code?: ErrorCode }).code;
  }
}

describe('QR rules (fixtures/qr.json)', () => {
  it('uses the parameters in the fixture', () => {
    const p = fixture.params;
    expect([p.maxLength, p.minAmount, p.fee]).toEqual([QR_MAX_LENGTH, TRANSFER_MIN_MINOR, TRANSFER_FEE_MINOR]);
  });

  it.each(fixture.parse.cases)('parseQr($input)', ({ input, expected }) => {
    expect(parseQr(input)).toEqual(expected);
  });

  it('never throws, whatever the input', () => {
    const weird = [
      '\u0000',
      '\uD800',
      'pocketly://pay/v1?m=m-01&r',
      'pocketly://pay/v99999999999999999999?m=x',
      '%%%',
      '?&=&',
    ];
    for (const input of weird) expect(parseQr(input).ok).toBe(false);
  });

  it("the seed's merchants and payment requests are the fixture's", () => {
    expect(MERCHANTS.map((m) => ({ id: m.counterparty.id, name: m.counterparty.name, category: m.category }))).toEqual(
      fixture.merchants.items,
    );
    expect(seedPaymentRequests(NOW)).toEqual(
      fixture.paymentRequests.seeded.map((r) => ({
        id: r.id,
        merchantId: r.merchantId,
        amount: r.amount,
        expiresAt: NOW + r.expiresInMs,
        ...(r.paid ? { paidBy: 'external' } : {}),
      })),
    );
  });

  it('My QR payloads round-trip through parseQr', () => {
    const payload = userQrPayload('u-0123456789ab');
    expect(payload).toBe(`${fixture.myQr.payloadPrefix}u-0123456789ab`);
    expect(parseQr(payload)).toEqual({ ok: true, kind: 'USER', userId: 'u-0123456789ab' });
  });
});

describe('fake server: merchants and payment requests (ADR-0016 §4)', () => {
  it.each(fixture.lookup.cases)('lookup $merchantId $requestId', async ({ merchantId, requestId, expect: e }) => {
    const api = await openServer();
    const result = api.getPaymentTarget(merchantId, requestId);
    if ('error' in e) {
      expect(await error(result)).toBe(e.error);
      return;
    }
    const target = await result;
    expect(target.merchant).toEqual({ kind: 'MERCHANT', id: merchantId, name: e.merchantName });
    expect(target.request).toEqual(
      'amount' in e ? { id: requestId, amount: e.amount, expiresAt: NOW + e.expiresInMs! } : undefined,
    );
  });

  it('walks fixtures/qr.json → server step by step', async () => {
    const api = await openServer();
    const results: (Transaction | undefined)[] = [];
    for (const [i, step] of fixture.server.steps.entries()) {
      const before = await api.getWallet();
      const s = step as {
        request?: { merchantId: string; requestId?: string; amount: number };
        transfer?: { recipientId: string; amount: number };
      };
      let tx: Transaction | undefined;
      let code: ErrorCode | undefined;
      try {
        tx = s.transfer ? await api.transfer(s.transfer, step.key) : await api.payMerchant(s.request!, step.key);
      } catch (e) {
        code = (e as { code: ErrorCode }).code;
      }
      const expect_ = step.expect as {
        sameAs?: number;
        error?: string;
        status?: string;
        failureReason?: string;
        id?: string;
      };
      const label = `step ${i}`;
      if (expect_.error !== undefined) {
        expect([label, code]).toEqual([label, expect_.error]);
      } else if (expect_.sameAs !== undefined) {
        expect([label, tx]).toEqual([label, results[expect_.sameAs]]);
      } else {
        expect([label, tx?.status, tx?.failureReason, tx?.id]).toEqual([
          label,
          expect_.status,
          expect_.failureReason,
          expect_.id,
        ]);
        const merchant = fixture.merchants.items.find((m) => m.id === s.request!.merchantId)!;
        expect(tx).toMatchObject({
          idempotencyKey: step.key,
          type: 'QR_PAYMENT',
          category: merchant.category,
          amount: s.request!.amount,
          counterparty: { kind: 'MERCHANT', id: merchant.id, name: merchant.name },
        });
      }
      results.push(tx);
      const after = await api.getWallet();
      expect([label, after.balance - before.balance, after.usedToday - before.usedToday]).toEqual([
        label,
        step.balanceDelta,
        step.usedTodayDelta,
      ]);
    }
  });

  it('a held payment holds its request; one that settles FAILED gives it back', async () => {
    const api = await openServer();
    api.network.set({ mode: 'TIMEOUT', failureRatePercent: 100 });
    void api.payMerchant({ merchantId: 'm-01', requestId: 'pr-0001', amount: 1_250 }, 'held');
    await new Promise((r) => setTimeout(r, 10));
    api.network.set({ mode: 'NORMAL', failureRatePercent: 0 });
    expect(await error(api.getPaymentTarget('m-01', 'pr-0001'))).toBe('QR_ALREADY_PAID');
    api.advanceClock(PENDING_RESOLVE_MAX_MS);
    expect((await api.getTransferByKey('held')).status).toBe('FAILED');
    expect((await api.getPaymentTarget('m-01', 'pr-0001')).request?.id).toBe('pr-0001');
  });

  it('resetData reseeds the requests and restarts the numbering', async () => {
    const api = await openServer();
    await api.payMerchant({ merchantId: 'm-01', requestId: 'pr-0001', amount: 1_250 }, 'a');
    await api.reset(DEFAULT_DATASET);
    expect((await api.payMerchant({ merchantId: 'm-01', requestId: 'pr-0001', amount: 1_250 }, 'b')).id).toBe('qrp-1');
  });
});

describe("fake server: the account's user id (ADR-0016 §6)", () => {
  const PATTERN = new RegExp(fixture.myQr.userIdPattern);

  async function verify(api: FakeWalletApi, phone: string) {
    await api.requestOtp(phone);
    return api.verifyOtp(phone, '123456');
  }

  it('is random per account, kept for the same phone and across resets, new for another phone', async () => {
    const otpNow = { ms: 0 };
    const api = await openServer(otpNow);
    expect(await error(api.getAccountUserId())).toBe('NOT_FOUND');
    const first = await verify(api, '+6281234567890');
    expect(first.userId).toMatch(PATTERN);
    expect(await api.getAccountUserId()).toBe(first.userId);
    await api.reset(DEFAULT_DATASET);
    expect(await api.getAccountUserId()).toBe(first.userId);
    otpNow.ms += 60_000; // past the resend wait
    expect((await verify(api, '+6281234567890')).userId).toBe(first.userId);
    otpNow.ms += 60_000;
    const other = await verify(api, '+6285712345678');
    expect(other.userId).toMatch(PATTERN);
    expect(other.userId).not.toBe(first.userId);
  });

  it('looks the account up as itself, so the client can refuse paying yourself', async () => {
    const api = await openServer();
    const { userId } = await verify(api, '+6281234567890');
    expect(await api.getContact(userId!)).toEqual({ userId, name: 'You', phone: '+6281234567890' });
    expect(await error(api.getContact('u-ffffffffffff'))).toBe('NOT_FOUND');
  });
});
