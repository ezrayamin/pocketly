import { useEffect } from 'react';
import { NativeModules } from 'react-native';

/**
 * NFR-SEC-03: sensitive screens stay out of screenshots and recordings. Android sets FLAG_SECURE;
 * iOS can't block screenshots, so it covers the window while the screen is recorded or mirrored.
 * A UI concern, identical in both builds (ADR-0005).
 */
interface NativeSecureScreen {
  setEnabled(enabled: boolean): void;
}

function native(): NativeSecureScreen {
  const module: NativeSecureScreen | undefined = NativeModules.PocketlySecureScreen;
  if (!module) {
    throw new Error('PocketlySecureScreen native module is not linked');
  }
  return module;
}

/** Screens that want protection right now; the window is protected while there's at least one. */
let holders = 0;

/** Protects the window while the calling component is mounted. */
export function useSecureScreen(): void {
  useEffect(() => {
    holders += 1;
    if (holders === 1) native().setEnabled(true);
    return () => {
      holders -= 1;
      if (holders === 0) native().setEnabled(false);
    };
  }, []);
}
