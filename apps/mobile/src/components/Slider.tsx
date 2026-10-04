import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../theme/tokens';

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
  /** Screen-reader text for a value, e.g. "40%". Defaults to the number. */
  valueText?: (value: number) => string;
  testID?: string;
}

/**
 * Dependency-free slider: drag or tap the track; screen readers get increment/decrement
 * (accessibilityRole "adjustable"), so it isn't touch-only.
 */
export function Slider({ value, min, max, step, onChange, accessibilityLabel, valueText, testID }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const valueAt = (x: number) => {
    const ratio = Math.min(1, Math.max(0, x / (widthRef.current || 1)));
    return Math.round((min + ratio * (max - min)) / step) * step;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => onChangeRef.current(valueAt(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => onChangeRef.current(valueAt(e.nativeEvent.locationX)),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const ratio = (value - min) / (max - min);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  return (
    <View
      style={styles.hit}
      onLayout={(e: LayoutChangeEvent) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text: valueText ? valueText(value) : String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? step : -step)))
      }
      testID={testID}
      {...responder.panHandlers}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: ratio * width }]} />
      </View>
      <View style={[styles.thumb, { left: ratio * width - 12 }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 36, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.textPrimary,
    borderWidth: 3,
    borderColor: colors.primary,
  },
});
