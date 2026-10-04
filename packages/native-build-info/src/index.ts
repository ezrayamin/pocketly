import { NativeModules } from 'react-native';

/**
 * Build-time switches (ADR-0008). Read once at startup from a native constant:
 *  - Android: bool resource `pocketly_dev_tools` (app/build.gradle; `-PproductionBuild` → false)
 *  - iOS:     Info.plist `PocketlyDevTools` ← build setting `POCKETLY_DEV_TOOLS` (default YES)
 * A native constant (not a JS env flag) so Metro's cache and the Gradle daemon can't serve a stale value.
 */
interface BuildInfo {
  /** Developer menu + `pocketly://dev/...` links. On for debug, demo and benchmark builds. */
  devToolsEnabled: boolean;
}

const constants: Partial<BuildInfo> | undefined = NativeModules.PocketlyBuildInfo?.getConstants?.();

export const buildInfo: BuildInfo = {
  // Missing module = a build we didn't configure: fail closed.
  devToolsEnabled: constants?.devToolsEnabled === true,
};
