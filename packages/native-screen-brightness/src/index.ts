import { useEffect } from 'react';
import { NativeModules } from 'react-native';

/**
 * FR-QR-05 (ADR-0016 §6): full brightness while My QR is shown, so another phone can scan it.
 * Android raises only this window's brightness, which the system drops when the window loses
 * focus; iOS sets the screen's and restores the previous value when the screen closes or the app
 * leaves the foreground. A UI concern, identical in both builds (ADR-0005).
 */
interface NativeBrightness {
  setRaised(raised: boolean): void;
}

function native(): NativeBrightness {
  const module: NativeBrightness | undefined = NativeModules.PocketlyBrightness;
  if (!module) {
    throw new Error('PocketlyBrightness native module is not linked');
  }
  return module;
}

/** Full brightness while the calling component is mounted. */
export function useMaxBrightness(): void {
  useEffect(() => {
    native().setRaised(true);
    return () => native().setRaised(false);
  }, []);
}
