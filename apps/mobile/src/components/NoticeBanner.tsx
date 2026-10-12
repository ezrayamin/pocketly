import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { UserError } from '../features/errors';
import { formatTime } from '../features/home/presentation';
import { colors, radius, spacing } from '../theme/tokens';

/**
 * A failed load, or data the core served from its replica (product §6.3, FR-HIST-04):
 * the reason, "Last updated hh:mm" when there is data on screen, and Retry.
 * testIDs: `${testIdPrefix}-error` and `${testIdPrefix}-last-updated`.
 */
export function NoticeBanner({
  notice,
  syncedAt,
  retrying,
  onRetry,
  testIdPrefix,
}: {
  notice: UserError;
  /** When the data on screen last came from the server. Omit when nothing is shown. */
  syncedAt?: number;
  retrying: boolean;
  onRetry: () => void;
  testIdPrefix: string;
}) {
  return (
    <View style={[styles.root, notice.offline && styles.offline]} accessibilityRole="alert" testID={`${testIdPrefix}-error`}>
      <View style={styles.body}>
        <Text style={[styles.message, notice.offline && styles.offlineMessage]}>{notice.message}</Text>
        {syncedAt !== undefined && (
          <Text style={styles.synced} testID={`${testIdPrefix}-last-updated`}>
            Last updated {formatTime(syncedAt)}
          </Text>
        )}
      </View>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" disabled={retrying} hitSlop={8}>
        <Text style={styles.retry}>{retrying ? '…' : 'Retry'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dangerDim,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  offline: { backgroundColor: colors.tertiaryDim },
  body: { flex: 1, gap: 2 },
  message: { color: colors.danger, fontWeight: '600' },
  offlineMessage: { color: colors.tertiary },
  synced: { color: colors.textSecondary, fontSize: 12 },
  retry: { color: colors.textPrimary, fontWeight: '700', marginLeft: spacing.md },
});
