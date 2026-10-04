import { NativeModules } from 'react-native';

/**
 * UI preferences (ADR-0005): identical in both builds, outside the core contract.
 * Backed by SharedPreferences "pocketly.preferences" (Android) / NSUserDefaults (iOS).
 * Business and security settings (PIN, biometrics, auto-lock) belong in the core instead.
 */
interface NativePreferences {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string): Promise<void>;
}

const KEYS = {
  balanceHidden: 'pocketly.ui.balanceHidden',
} as const;

function native(): NativePreferences {
  const module: NativePreferences | undefined = NativeModules.PocketlyPreferences;
  if (!module) {
    throw new Error('PocketlyPreferences native module is not linked');
  }
  return module;
}

export const uiPreferences = {
  /** FR-HOME-02. Defaults to visible. */
  async getBalanceHidden(): Promise<boolean> {
    return (await native().getString(KEYS.balanceHidden)) === 'true';
  },
  setBalanceHidden(hidden: boolean): Promise<void> {
    return native().setString(KEYS.balanceHidden, String(hidden));
  },
};
