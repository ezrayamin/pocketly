import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppNotification } from '@pocketly/core-contract';
import { NoticeBanner } from '../../components/NoticeBanner';
import { ArrowDownLeft, Bell, ChevronLeft, CircleCheck, CircleX } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError, type UserError } from '../errors';
import { relativeDay } from '../home/presentation';
import { notificationText } from './notificationCopy';
import { useNotifications } from './NotificationsProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

/**
 * FR-NOTIF-03 (product §7.4): the newest 50, from the replica (works offline). Opening it marks them all
 * read; this visit still shows which were new. Tap one for its transaction.
 */
export function NotificationsScreen({ navigation }: Props) {
  const { version, markAllRead } = useNotifications();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<UserError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Reloads when more arrive while it's open; those are read at once too.
  useEffect(() => {
    let live = true;
    core.getNotifications().then(
      (list) => {
        if (!live) return;
        setItems(list.items);
        setError(null);
        if (list.unreadCount > 0) markAllRead().catch(() => {});
      },
      (e: unknown) => live && setError(toUserError(e)),
    );
    return () => {
      live = false;
    };
  }, [version, attempt, markAllRead]);

  const now = Date.now();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="notifications-screen">
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          testID="notifications-back"
        >
          <ChevronLeft color={colors.textPrimary} size={26} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Notifications
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {error && !items && (
        <View style={styles.content}>
          <NoticeBanner
            notice={error}
            retrying={false}
            onRetry={() => setAttempt((n) => n + 1)}
            testIdPrefix="notifications"
          />
        </View>
      )}
      {items && items.length === 0 && (
        <View style={styles.empty} testID="notifications-empty">
          <Bell color={colors.textMuted} size={36} />
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyBody}>Money you receive and payments that finish later show up here.</Text>
        </View>
      )}
      {items && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.content}
          renderItem={({ item }) => (
            <NotificationRow
              notification={item}
              now={now}
              onPress={() =>
                navigation.navigate('TransactionDetail', { id: item.transaction.id, tx: item.transaction })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function NotificationRow({
  notification: n,
  now,
  onPress,
}: {
  notification: AppNotification;
  now: number;
  onPress: () => void;
}) {
  const { title, body } = notificationText(n);
  const failed = n.kind === 'TRANSACTION_SETTLED' && n.transaction.status === 'FAILED';
  const Icon = n.kind === 'MONEY_RECEIVED' ? ArrowDownLeft : failed ? CircleX : CircleCheck;
  const when = relativeDay(n.createdAt, now);
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n.read ? '' : 'New. '}${title}. ${body}. ${when}`}
      testID={`notification-${n.id}`}
    >
      <View style={[styles.icon, failed && styles.iconFailed]}>
        <Icon color={failed ? colors.danger : colors.primary} size={18} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowBody} numberOfLines={2}>
          {body}
        </Text>
        <Text style={styles.rowTime}>{when}</Text>
      </View>
      {!n.read && <View style={styles.unread} testID={`notification-unread-${n.id}`} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...type.body, color: colors.textPrimary },
  headerSpacer: { width: 26 },
  content: { padding: spacing.lg, gap: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { ...type.body, color: colors.textPrimary },
  emptyBody: { ...type.caption, color: colors.textSecondary, textAlign: 'center', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
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
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: colors.textPrimary },
  rowBody: { ...type.caption, color: colors.textSecondary, fontSize: 13 },
  rowTime: { ...type.caption, color: colors.textMuted },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
});
