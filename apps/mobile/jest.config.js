module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@pocketly/core-impl$': '@pocketly/core-js',
  },
  transform: {
    // lucide-react-native ships per-icon ES modules (.mjs).
    '^.+\\.mjs$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@shopify/flash-list|@pocketly|lucide-react-native|react-native-svg|react-native-screens)/)',
  ],
};
