import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { flowMark } from '@pocketly/bench-app';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../navigation';
import { ArrowUpRight, CreditCard, QrCode, ScanLine, type LucideIcon } from '../../../components/icons';
import { colors } from '../../../theme/tokens';

/**
 * FR-HOME-03. Send opens its flow (F5). Top-Up (F6), Pay (F7) and Receive (F8) are still
 * placeholders until those features exist.
 */
const ACTIONS: { label: string; Icon: LucideIcon; primary?: boolean; route?: 'SendRecipient' }[] = [
  { label: 'Send', Icon: ArrowUpRight, primary: true, route: 'SendRecipient' },
  { label: 'Top-Up', Icon: CreditCard },
  { label: 'Pay (QR)', Icon: ScanLine },
  { label: 'Receive', Icon: QrCode },
];

export function QuickActions() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={styles.row}>
      {ACTIONS.map(({ label, Icon, primary, route }) => (
        <Pressable
          key={label}
          style={styles.action}
          onPress={
            route
              ? () => {
                  flowMark('send-tap');
                  navigation.navigate(route);
                }
              : undefined
          }
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={route ? undefined : 'Coming soon'}
          testID={`quick-${label.toLowerCase().replace(/[^a-z]/g, '')}`}
        >
          <View style={[styles.circle, primary && styles.circlePrimary]}>
            <Icon color={primary ? colors.onPrimary : colors.textPrimary} size={primary ? 26 : 22} />
          </View>
          <Text style={styles.label}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { alignItems: 'center', gap: 8, flex: 1 },
  circle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circlePrimary: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});
