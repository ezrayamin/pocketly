import type { Core } from '@pocketly/core-contract';
// Virtual module: Metro resolves it to @pocketly/core-js or @pocketly/core-kmp at bundle
// time (metro.config.js). Screens import `core` from here and types from core-contract,
// never from either implementation directly.
import { core as impl } from '@pocketly/core-impl';

export const core: Core = impl;

if (__DEV__) {
  // A debug build loads JS from Metro, so a Metro serving the other core would silently
  // run the wrong one. Only kmpCore native builds register the `PocketlyCore` HybridObject.
  const { NitroModules } = require('react-native-nitro-modules');
  const nativeIsKmp: boolean = NitroModules.hasHybridObject('PocketlyCore');
  if (nativeIsKmp !== (core.impl === 'kmp')) {
    throw new Error(
      `Core mismatch: this is a ${nativeIsKmp ? 'kmpCore' : 'jsCore'} build but Metro served core-${core.impl}. ` +
        `Use \`yarn ${nativeIsKmp ? 'start:kmp' : 'start'}\` (port ${nativeIsKmp ? 8082 : 8081}).`,
    );
  }
}
