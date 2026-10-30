import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppNotification } from '@pocketly/core-contract';
import { ArrowDownLeft, CircleCheck, CircleX, X } from '../../components/icons';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { notificationText } from './notificationCopy';

/** How long a banner stays if it isn't touched. */
export const BANNER_MS = 5_000;

/** FR-NOTIF-01/02: one new notification, over whatever screen is open. Tap View for the transaction. */
export function NotificationBanner({
  notification,
  onView,
  onDismiss,
}: {
  notification: AppNotification;
  onView: () => void;
  /** Stable: the auto-hide timer restarts when it changes. */
  onDismiss: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { id } = notification;
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), BANNER_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, id]);

  const { title, body } = notificationText(notification);
  const tx = notification.transaction;
  const failed = notification.kind === 'TRANSACTION_SETTLED' && tx.status === 'FAILED';
  const Icon = notification.kind === 'MONEY_RECEIVED' ? ArrowDownLeft : failed ? CircleX : CircleCheck;

  return (
    <View style={[styles.wrap, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
      <View
        style={styles.banner}
        accessibilityRole="alert"
        accessibilityLabel={`${title}. ${body}`}
        testID="notification-banner"
      >
        <View style={[styles.icon, failed && styles.iconFailed]}>
          <Icon color={failed ? colors.danger : colors.primary} size={18} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1} testID="notification-banner-title">
            {title}
          </Text>
          <Text style={styles.body} numberOfLines={2} testID="notification-banner-body">
            {body}
          </Text>
        </View>
        <Pressable
          style={styles.view}
          onPress={onView}
          accessibilityRole="button"
          accessibilityLabel="View"
          testID="notification-banner-view"
        >
          <Text style={styles.viewText}>View</Text>
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={() => onDismiss(id)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          testID="notification-banner-dismiss"
        >
          <X color={colors.textSecondary} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFailed: { backgroundColor: colors.dangerDim },
  text: { flex: 1 },
  title: { ...type.body, color: colors.textPrimary },
  body: { ...type.caption, color: colors.textSecondary, fontSize: 13 },
  view: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  viewText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
});
