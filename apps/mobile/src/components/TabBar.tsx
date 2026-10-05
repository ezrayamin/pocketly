import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '../theme/tokens';
import { History, House, ScanLine, User, type LucideIcon } from './icons';

/**
 * Bottom tab bar (product.md §7.1): the MVP's 4 tabs, Pay as the raised center button.
 * Invest becomes a 5th tab once F10 ships. Pay is a placeholder until F7 exists.
 * Selecting the active tab is reported too (scroll to top, §7.3 rule 5).
 */
export type TabKey = 'home' | 'history' | 'pay' | 'profile';
const ENABLED: readonly TabKey[] = ['home', 'history', 'profile'];
const TABS: { key: TabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'home', label: 'Home', Icon: House },
  { key: 'history', label: 'History', Icon: History },
  { key: 'pay', label: 'Pay', Icon: ScanLine },
  { key: 'profile', label: 'Profile', Icon: User },
];

export function TabBar({ active, onSelect }: { active: TabKey; onSelect: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityRole="tablist">
      <View style={styles.bar}>
        {TABS.map(({ key, label, Icon }) => {
          const selected = key === active;
          const enabled = ENABLED.includes(key);
          const isPay = key === 'pay';
          return (
            <Pressable
              key={key}
              style={styles.tab}
              onPress={enabled ? () => onSelect(key) : undefined}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected, disabled: !enabled }}
              accessibilityHint={enabled ? undefined : 'Coming soon'}
              testID={`tab-${key}`}
            >
              {isPay ? (
                <View style={styles.payButton}>
                  <Icon color={colors.onPrimary} size={24} />
                </View>
              ) : (
                <Icon color={selected ? colors.primary : colors.textSecondary} size={22} />
              )}
              <Text style={[styles.label, selected && styles.labelActive, isPay && styles.payLabel]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: colors.background,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.xl,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  label: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  labelActive: { color: colors.primary },
  payButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginTop: -30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  payLabel: { marginTop: 2 },
});

export const TAB_BAR_HEIGHT = 96;
