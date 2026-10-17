module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@pocketly/core-impl$': '@pocketly/core-js',
    // Tests always include the benchmark harness (perf bundles do; release bundles don't).
    '^@pocketly/bench-app$': '<rootDir>/src/bench/index.ts',
    '^@pocketly/bench-impl$': '@pocketly/core-js-bench',
  },
  transform: {
    // lucide-react-native ships per-icon ES modules (.mjs).
    '^.+\\.mjs$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@shopify/flash-list|@pocketly|lucide-react-native|react-native-svg|react-native-screens)/)',
  ],
};
