jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// Tests run the jsCore build: no native `PocketlyCore` HybridObject is registered.
jest.mock('react-native-nitro-modules', () => ({ NitroModules: { hasHybridObject: () => false } }));
// In-memory stand-in for the native SharedPreferences/NSUserDefaults module.
jest.mock('@pocketly/native-preferences', () => {
  let balanceHidden = false;
  return {
    uiPreferences: {
      getBalanceHidden: async () => balanceHidden,
      setBalanceHidden: async (hidden) => {
        balanceHidden = hidden;
      },
    },
  };
});
