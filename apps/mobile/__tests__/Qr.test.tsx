/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import { DataScanner } from 'react-native-data-scanner';
import { LIVE_DATASET, NETWORK_NORMAL } from '@pocketly/core-contract';
import { verifyTestPhone } from '@pocketly/core-contract/src/testing/onboarding';
import App from '../App';
import { QrCodeView } from '../src/components/QrCodeView';
import { core } from '../src/core';
import { applyDevLink } from '../src/features/devmenu/devLinks';
import { resultCopy, scanProblem } from '../src/features/qr/qrCopy';
import { classify } from '../src/features/qr/scanQr';

/** Slice 7 (F7, F8): QR Pay and My QR through the real jsCore; the platform scanner is mocked. */
const PIN = '482915';
const START = 1_459_085; // LIVE_DATASET's balance
jest.setTimeout(20_000);
type Tree = ReactTestRenderer.ReactTestRenderer;
const scanBarcode = DataScanner.scanBarcode as jest.Mock;

/** The next scans return these, in order: a code, or an Error the library would throw. */
function nextScans(...results: (string | Error)[]) {
  for (const r of results) {
    if (r instanceof Error) scanBarcode.mockRejectedValueOnce(r);
    else scanBarcode.mockResolvedValueOnce({ value: r, format: 'qr' });
  }
}

async function launch(): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App launchArgs={{ skipLock: 'true' }} />);
  });
  return tree;
}

function has(tree: Tree, testID: string): boolean {
  return tree.root.findAll((n) => n.props.testID === testID).length > 0;
}

function text(tree: Tree, testID: string): string {
  const node = tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string')[0];
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c);
}

async function until(tree: Tree, condition: () => boolean, timeoutMs = 5_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the UI');
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function press(tree: Tree, testID: string) {
  await until(tree, () => has(tree, testID));
  await ReactTestRenderer.act(async () => {
    tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0].props.onPress();
  });
}

async function typeAmount(tree: Tree, keys: string) {
  for (const k of keys) await press(tree, `amount-key-${k === '.' ? 'dot' : k}`);
}

async function enterPin(tree: Tree, pin: string) {
  for (const digit of pin) await press(tree, `pin-key-${digit}`);
}

beforeAll(async () => {
  await core.resetAuth();
  await verifyTestPhone(core);
  await core.setPin(PIN);
});

beforeEach(async () => {
  scanBarcode.mockReset();
  core.setNetworkSimulation(NETWORK_NORMAL);
  await core.resetData(LIVE_DATASET);
});

describe('QR Pay (F7, jsCore)', () => {
  it("static code: the merchant is the server's, the user types the amount, the PIN approves it", async () => {
    nextScans('pocketly://pay/v1?m=m-01');
    const tree = await launch();
    await press(tree, 'quick-payqr');
    await until(tree, () => has(tree, 'qr-amount'));
    expect(text(tree, 'qr-amount-merchant')).toBe('Corner Coffee');
    await typeAmount(tree, '12.5');
    await press(tree, 'qr-amount-review');
    await until(tree, () => has(tree, 'qr-review'));
    expect(text(tree, 'qr-review-amount')).toBe('$12.50');
    expect(text(tree, 'qr-review-merchant')).toBe('to Corner Coffee');

    await press(tree, 'qr-review-confirm'); // biometrics are off: the shared PIN screen
    await until(tree, () => has(tree, 'send-pin'));
    await enterPin(tree, PIN);
    await until(tree, () => has(tree, 'qr-result-success'));
    expect(text(tree, 'qr-result-title')).toBe('Paid');
    expect(text(tree, 'qr-result-tx-id')).toBe('qrp-1');
    expect((await core.getWallet()).balance).toBe(START - 1_250);

    await press(tree, 'qr-result-done');
    await until(tree, () => has(tree, 'balance') && text(tree, 'balance') === '$14,578.35');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('dynamic code: straight to review with the locked amount; the same code then reads as paid', async () => {
    nextScans('pocketly://pay/v1?m=m-01&r=pr-0001');
    const tree = await launch();
    await press(tree, 'tab-pay');
    await until(tree, () => has(tree, 'qr-review'));
    expect(text(tree, 'qr-review-amount')).toBe('$12.50');
    await press(tree, 'qr-review-confirm');
    await enterPin(tree, PIN);
    await until(tree, () => has(tree, 'qr-result-success'));
    await press(tree, 'qr-result-done');

    nextScans('pocketly://pay/v1?m=m-01&r=pr-0001');
    await press(tree, 'tab-pay');
    await until(tree, () => has(tree, 'qr-scan-problem'));
    expect(text(tree, 'qr-scan-message')).toBe('This payment code has already been paid.');
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('an invalid code says so and scans again; cancelling the scanner goes back', async () => {
    nextScans('https://example.com/not-ours', 'pocketly://pay/v1?m=m-03');
    const tree = await launch();
    await press(tree, 'quick-payqr');
    await until(tree, () => has(tree, 'qr-scan-problem'));
    expect(text(tree, 'qr-scan-message')).toBe("This isn't a valid payment code.");
    await press(tree, 'qr-scan-again');
    await until(tree, () => has(tree, 'qr-amount'));
    expect(text(tree, 'qr-amount-merchant')).toBe('Metro Transit');
    ReactTestRenderer.act(() => tree.unmount());

    nextScans(new Error('Barcode scan was canceled.'));
    const second = await launch();
    await press(second, 'quick-payqr');
    await until(second, () => !has(second, 'qr-scan') && has(second, 'balance'));
    ReactTestRenderer.act(() => second.unmount());
  });

  it('no camera access offers Settings (FR-QR-01)', async () => {
    nextScans(new Error('Barcode scanning is unavailable. Check camera permission and device restrictions.'));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const tree = await launch();
    await press(tree, 'quick-payqr');
    await press(tree, 'qr-scan-settings');
    expect(openSettings).toHaveBeenCalled();
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('expired and unknown codes, and offline, stop with a clear message', async () => {
    const tree = await launch();
    for (const [code, message] of [
      ['pocketly://pay/v1?m=m-02&r=pr-0002', 'This payment code has expired. Ask for a new one.'],
      ['pocketly://pay/v1?m=m-99', "This isn't a valid payment code."],
    ]) {
      nextScans(code);
      await press(tree, 'tab-pay');
      await until(tree, () => has(tree, 'qr-scan-problem'));
      expect(text(tree, 'qr-scan-message')).toBe(message);
      await press(tree, 'qr-scan-close');
      await until(tree, () => !has(tree, 'qr-scan'));
    }
    core.setNetworkSimulation({ mode: 'OFFLINE', failureRatePercent: 0 });
    nextScans('pocketly://pay/v1?m=m-01');
    await press(tree, 'tab-pay');
    await until(tree, () => has(tree, 'qr-scan-problem'));
    expect(text(tree, 'qr-scan-message')).toBe("You're offline. Check your connection and try again.");
    ReactTestRenderer.act(() => tree.unmount());
  });

  it("a Pocketly user's code starts the Send flow; your own code is refused", async () => {
    nextScans('pocketly://user/v1?u=u-01');
    const tree = await launch();
    await press(tree, 'quick-payqr');
    await until(tree, () => has(tree, 'send-amount'));
    await press(tree, 'send-back');
    await until(tree, () => has(tree, 'balance') && !has(tree, 'send-amount'));

    nextScans(await core.getMyQr());
    await press(tree, 'quick-payqr');
    await until(tree, () => has(tree, 'qr-scan-problem'));
    expect(text(tree, 'qr-scan-message')).toBe("That's your own code. Show it to someone who's paying you.");
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('a dev link hands a code to the scanner screen (ADR-0016 §7)', async () => {
    expect(await applyDevLink(`pocketly://dev/scan?code=${encodeURIComponent('pocketly://pay/v1?m=m-01')}`)).toEqual({
      action: 'scan',
      detail: 'pocketly://pay/v1?m=m-01',
    });
  });
});

describe('My QR (F8, FR-QR-05)', () => {
  it("Receive shows this account's code; Profile has it too", async () => {
    const tree = await launch();
    await press(tree, 'quick-receive');
    await until(tree, () => has(tree, 'my-qr-code'));
    const code = tree.root.findAll((n) => n.props.testID === 'my-qr-code' && typeof n.props.value === 'string')[0];
    expect(code.props).toMatchObject({ value: await core.getMyQr(), size: 240 });
    await press(tree, 'my-qr-done');
    await until(tree, () => !has(tree, 'my-qr'));
    await press(tree, 'tab-profile');
    await press(tree, 'profile-my-qr');
    await until(tree, () => has(tree, 'my-qr-code'));
    ReactTestRenderer.act(() => tree.unmount());
  });

  it('draws the payload as a QR code with a quiet zone', async () => {
    let tree!: Tree;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<QrCodeView value="pocketly://user/v1?u=u-0123456789ab" size={200} />);
    });
    const svg = tree.root.findAll((n) => typeof n.props.viewBox === 'string')[0];
    expect(svg.props.viewBox).toBe('0 0 37 37'); // 34 bytes at level M: version 3, 29 modules, + 2 × 4
    const path = tree.root.findAll((n) => typeof n.props.d === 'string')[0];
    expect(path.props.d.length).toBeGreaterThan(100);
  });
});

describe('QR copy and scanner errors', () => {
  it("sorts react-native-data-scanner's errors", () => {
    expect(classify('Barcode scan was canceled.')).toEqual({ kind: 'CANCELLED' });
    expect(classify('Android barcode scanner module installation was canceled.')).toEqual({ kind: 'CANCELLED' });
    expect(classify('Barcode scanning is unavailable. Check camera permission and device restrictions.')).toEqual({
      kind: 'NO_CAMERA_ACCESS',
    });
    expect(classify('Barcode scanning is not supported on this device.').kind).toBe('UNSUPPORTED');
    expect(classify('Barcode scanning requires iOS 16.0 or later.').kind).toBe('UNSUPPORTED');
    expect(classify('A barcode scan is already in progress.')).toEqual({ kind: 'FAILED' });
  });

  it('names the problem and the result', () => {
    expect(scanProblem('QR_ALREADY_PAID')).toBe('This payment code has already been paid.');
    expect(
      resultCopy({ id: 'x', state: 'FAILED', auth: 'OK', failureReason: 'SERVER_ERROR', retryable: true }).title,
    ).toBe("Payment didn't go through");
    expect(resultCopy({ id: 'x', state: 'SUCCESS', auth: 'OK' }).title).toBe('Paid');
  });
});
