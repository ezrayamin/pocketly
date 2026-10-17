/* eslint-env jest */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// FlashList measures its parent and cells natively; this gives them a fixed size under Jest.
require('@shopify/flash-list/jestSetup');
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
// FLAG_SECURE / capture cover (NFR-SEC-03): tests can read which screens asked for it.
jest.mock('@pocketly/native-secure-screen', () => ({ useSecureScreen: jest.fn() }));
// Developer tools are on in every build this project produces (ADR-0008).
jest.mock('@pocketly/native-build-info', () => ({ buildInfo: { devToolsEnabled: true } }));
// op-sqlite (jsCore's storage, ADR-0009) on Node's built-in SQLite. Only what
// core-js/src/data/db/opSqliteDriver.ts uses. Databases are in memory and keyed by name, so
// reopening one within a test file sees the same data.
jest.mock('@op-engineering/op-sqlite', () => {
  const { DatabaseSync } = require('node:sqlite');
  const databases = new Map();
  return {
    open: ({ name }) => {
      if (!databases.has(name)) databases.set(name, new DatabaseSync(':memory:'));
      const db = databases.get(name);
      const execute = (sql, params = []) => {
        const statement = db.prepare(sql);
        if (statement.columns().length > 0) return { rows: statement.all(...params), rowsAffected: 0 };
        return { rows: [], rowsAffected: Number(statement.run(...params).changes) };
      };
      return {
        execute: async (sql, params) => {
          // Without params it's the driver's exec(): DDL / pragmas, possibly several statements.
          if (params === undefined) {
            db.exec(sql);
            return { rows: [], rowsAffected: 0 };
          }
          return execute(sql, params);
        },
        transaction: async (fn) => {
          db.exec('BEGIN');
          try {
            await fn();
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
        },
        prepareStatement: (sql) => {
          const statement = db.prepare(sql);
          let bound = [];
          return {
            bindSync: (params) => {
              bound = params;
            },
            executeSync: () => ({ rows: [], rowsAffected: Number(statement.run(...bound).changes) }),
          };
        },
        close: () => {},
      };
    },
  };
});
// jsCore's PIN crypto (ADR-0010) on Node's crypto, which is OpenSSL too.
jest.mock('react-native-quick-crypto', () => ({ ...require('node:crypto'), Buffer: require('node:buffer').Buffer }));
// jsCore's secure storage (ADR-0010) in memory. Only what core-js/src/security/sensitiveInfoStore.ts uses.
jest.mock('react-native-sensitive-info', () => {
  const items = new Map();
  return {
    getItem: async (key) => (items.has(key) ? { key, value: items.get(key) } : null),
    setItem: async (key, value) => {
      items.set(key, value);
    },
    deleteItem: async (key) => items.delete(key),
    clearService: async () => items.clear(),
    isKeyInvalidatedError: () => false,
    isIntegrityViolationError: () => false,
  };
});
// jsCore's biometric key (ADR-0012): a software P-256 key. Tests script scans through `__scans`
// ('MATCH' | 'CANCEL' | 'LOCKOUT' | 'INVALIDATED') and hardware through `__state`.
jest.mock('@sbaiahmed1/react-native-biometrics', () => {
  const crypto = require('node:crypto');
  const { Buffer } = require('node:buffer');
  const state = { available: true, key: undefined };
  const scans = [];
  return {
    __state: state,
    __scans: scans,
    BiometricStrength: { Strong: 'strong', Weak: 'weak' },
    InputEncoding: { UTF8: 'utf8', Base64: 'base64' },
    isSensorAvailable: async () =>
      state.available ? { available: true, biometryType: 'TouchID' } : { available: false, errorCode: 'BiometricErrorNoneEnrolled' },
    createKeysWithOptions: async () => {
      const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      state.key = pair.privateKey;
      return { publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
    },
    deleteKeys: async () => {
      state.key = undefined;
      return { success: true };
    },
    signWithOptions: async ({ data }) => {
      const scan = scans.shift() ?? 'MATCH';
      if (scan === 'CANCEL') return { success: false, errorCode: 'USER_CANCELED' };
      if (scan === 'LOCKOUT') return { success: false, errorCode: 'BIOMETRIC_LOCKOUT' };
      if (scan === 'INVALIDATED' || !state.key) return { success: false, errorCode: 'KEY_INVALIDATED' };
      const signature = crypto.sign('sha256', Buffer.from(data, 'base64'), { key: state.key, dsaEncoding: 'der' });
      return { success: true, signature: signature.toString('base64') };
    },
  };
});
