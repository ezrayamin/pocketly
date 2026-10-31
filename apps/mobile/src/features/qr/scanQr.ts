import { DataScanner } from 'react-native-data-scanner';

/**
 * FR-QR-01 (ADR-0016 §7): one scan with the platform's own scanner UI (Google's code scanner on
 * Android, which needs no camera permission; VisionKit on iOS). The camera runs only while that UI
 * is up. The library reports everything but a code as an error message, sorted here.
 */
export type ScanOutcome =
  | { kind: 'SCANNED'; value: string }
  | { kind: 'CANCELLED' }
  /** No camera access (iOS): the fix is in Settings. */
  | { kind: 'NO_CAMERA_ACCESS' }
  | { kind: 'UNSUPPORTED'; message: string }
  | { kind: 'FAILED' };

export async function scanQr(): Promise<ScanOutcome> {
  try {
    const barcode = await DataScanner.scanBarcode({ targetFormats: ['qr'], enableAutoZoom: true });
    return { kind: 'SCANNED', value: barcode.value };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[Pocketly] scanner: ${message}`); // the library's own words, no user data
    return classify(message);
  }
}

/** Exported for tests. Matches react-native-data-scanner 0.1.2's messages. */
export function classify(message: string): ScanOutcome {
  if (/cancel/i.test(message)) return { kind: 'CANCELLED' };
  if (/permission|unavailable/i.test(message)) return { kind: 'NO_CAMERA_ACCESS' };
  if (/not supported/i.test(message)) return { kind: 'UNSUPPORTED', message: "This device can't scan codes." };
  if (/iOS 16/i.test(message)) return { kind: 'UNSUPPORTED', message: 'Scanning codes needs iOS 16 or later.' };
  return { kind: 'FAILED' };
}
