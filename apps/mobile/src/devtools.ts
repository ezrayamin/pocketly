import { buildInfo } from '@pocketly/native-build-info';

/**
 * Developer tools (menu + pocketly://dev links): FR-DEV-01 "debug/demo builds". Every build
 * this project produces is one of those (debug, demo video, benchmarks), so they're on by
 * default; a store build turns them off natively (ADR-0008).
 */
export const DEV_TOOLS_ENABLED = buildInfo.devToolsEnabled;
