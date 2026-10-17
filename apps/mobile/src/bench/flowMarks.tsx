import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

/**
 * BM-07 (docs/benchmarking.md §6): timestamps of the Send flow's steps, from
 * `performance.now()`. Perf bundles only: release resolves `@pocketly/bench-app` to
 * disabled.ts, where both exports do nothing.
 *
 * Each "-shown" mark fires in the screen's first effect once its data is on screen; each "-tap"
 * mark when the input is handled, so tap → shown is the app's own latency for a step whatever
 * the driver's pacing. The marks are not logged: the vivo V2538 rate-limits app logging
 * (persist.log.ratelimit) and dropped them. The result screen renders them instead, in an
 * element the runner reads with `uiautomator` once the measured part is over.
 */
declare const performance: { now(): number };

let marks: string[] = [];

export function flowMark(name: string): void {
  if (name === 'send-tap') marks = []; // a new flow
  marks.push(`${name}=${performance.now().toFixed(1)}`);
}

/** On the result screen: the marks so far, as `name=ms;…`, for bm-07-flow.sh verify. */
export function FlowMarksProbe() {
  const [text, setText] = useState('');
  // A tick later: the result screen's own effect (its "result-shown-…" mark) runs after this one.
  useEffect(() => {
    const id = setTimeout(() => setText(marks.join(';')), 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <Text style={styles.probe} accessibilityLabel={`flow-marks ${text}`} testID="flow-marks">
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  // Tiny and nearly transparent: off the user's eye, but still in the accessibility tree.
  probe: { position: 'absolute', left: 0, bottom: 0, width: 2, height: 2, opacity: 0.02, fontSize: 1 },
});
