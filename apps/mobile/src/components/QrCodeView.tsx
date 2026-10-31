import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

/**
 * Draws `value` as a QR code with react-native-svg (ADR-0016 §6): dark modules on white with a
 * four-module quiet zone, as scanners expect, whatever the app's theme.
 */
export function QrCodeView({ value, size, testID }: { value: string; size: number; testID?: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
    return { path: d, count: n + QUIET * 2 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} testID={testID}>
      <Rect width={count} height={count} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}

const QUIET = 4;
