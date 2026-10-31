import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { badgeLabel } from '../features/notifications/notificationCopy';
import { useNotifications } from '../features/notifications/NotificationsProvider';
import type { RootStackParamList } from '../navigation';
import { colors, radius, type } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Bell, Wallet } from './icons';

/**
 * Top bar of the tab screens: brand, the screen's name, notifications, avatar. The bell carries the
 * unread badge and opens the Notifications screen (FR-NOTIF-03). The avatar is a static placeholder.
 */
export function AppHeader({ subtitle }: { subtitle: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { unreadCount } = useNotifications();
  const badge = badgeLabel(unreadCount);
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Wallet color={colors.primary} size={20} />
        </View>
        <View>
          <Text style={styles.title} accessibilityRole="header">
            Pocketly
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation.navigate('Notifications')}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          testID="header-bell"
        >
          <Bell color={colors.textPrimary} size={20} />
          {badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText} testID="header-bell-badge">
                {badge}
              </Text>
            </View>
          )}
        </Pressable>
        <Avatar id="me" name="Rina Wijaya" size={36} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.title, color: colors.textPrimary },
  subtitle: { ...type.caption, color: colors.textSecondary, marginTop: -2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  badgeText: { color: colors.onPrimary, fontSize: 10, fontWeight: '800' },
});
