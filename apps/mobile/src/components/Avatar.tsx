import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { avatarColor, initials } from '../features/home/presentation';

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(id) }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.text, { fontSize: size * 0.36 }]} allowFontScaling={false}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
