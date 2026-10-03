jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// Tests run the jsCore build: no native `PocketlyCore` HybridObject is registered.
jest.mock('react-native-nitro-modules', () => ({ NitroModules: { hasHybridObject: () => false } }));
