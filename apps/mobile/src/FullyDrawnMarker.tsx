import React from 'react';
import { View } from 'react-native';

/** Must match FULLY_DRAWN_MARKER in android/.../FullyDrawnReporter.kt. */
export const FULLY_DRAWN_TEST_ID = 'pocketly.fullyDrawn';

/**
 * BM-01 "time to fully drawn". Render this once the first screen shows real data.
 *
 * Calling Activity.reportFullyDrawn() from JS is too early: effects run after React
 * commits but BEFORE Fabric mounts and draws the native views, so Android would stamp an
 * earlier (sometimes the empty first) frame. Instead, native code reports in the draw pass
 * of the first frame that actually contains this view (FullyDrawnReporter.kt).
 */
export function FullyDrawnMarker() {
  // collapsable={false}: Fabric would otherwise flatten an empty view away.
  return <View testID={FULLY_DRAWN_TEST_ID} collapsable={false} style={{ width: 0, height: 0 }} />;
}
