import React from 'react';
import { View, type DimensionValue, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme/tokens';

/** Static placeholder block (FR-HOME-01: skeleton while loading, no layout shift). */
export function Skeleton({ width, height, style }: { width: DimensionValue; height: number; style?: ViewStyle }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.skeleton }, style]}
    />
  );
}
