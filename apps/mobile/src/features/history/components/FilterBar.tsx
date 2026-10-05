import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TransactionStatus } from '@pocketly/core-contract';
import {
  ArrowLeftRight,
  Check,
  CirclePlus,
  CircleX,
  Clock,
  ScanLine,
  type LucideIcon,
} from '../../../components/icons';
import { colors, radius, spacing } from '../../../theme/tokens';
import { NO_FILTER, type HistoryFilter, type TypeGroup } from '../useHistory';

const TYPES: { value: TypeGroup; label: string; Icon: LucideIcon }[] = [
  { value: 'TRANSFER', label: 'Transfers', Icon: ArrowLeftRight },
  { value: 'TOP_UP', label: 'Top-Ups', Icon: CirclePlus },
  { value: 'QR_PAYMENT', label: 'QR Payments', Icon: ScanLine },
];

const STATUSES: {
  value: TransactionStatus;
  label: string;
  Icon: LucideIcon;
}[] = [
  { value: 'SUCCESS', label: 'Completed', Icon: Check },
  { value: 'PENDING', label: 'Pending', Icon: Clock },
  { value: 'FAILED', label: 'Failed', Icon: CircleX },
];

function Chip({
  label,
  Icon,
  selected,
  onPress,
  testID,
}: {
  label: string;
  Icon: LucideIcon;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter: ${label}`}
      accessibilityState={{ selected }}
      testID={testID}
    >
      <Icon
        color={selected ? colors.onPrimary : colors.textSecondary}
        size={14}
      />
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * FR-HIST-03: type chips ("All" and the type groups), statuses on the row below. One of
 * each kind at most; tapping a selected chip clears it, "All" clears both.
 */
export function FilterBar({
  filter,
  onChange,
}: {
  filter: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
}) {
  const all = filter.type === null && filter.status === null;
  return (
    <View style={styles.rows}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Chip
          label="All"
          Icon={Check}
          selected={all}
          onPress={() => onChange(NO_FILTER)}
          testID="filter-all"
        />
        {TYPES.map(({ value, label, Icon }) => (
          <Chip
            key={value}
            label={label}
            Icon={Icon}
            selected={filter.type === value}
            onPress={() =>
              onChange({
                ...filter,
                type: filter.type === value ? null : value,
              })
            }
            testID={`filter-type-${value}`}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {STATUSES.map(({ value, label, Icon }) => (
          <Chip
            key={value}
            label={label}
            Icon={Icon}
            selected={filter.status === value}
            onPress={() =>
              onChange({
                ...filter,
                status: filter.status === value ? null : value,
              })
            }
            testID={`filter-status-${value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.sm },
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: colors.onPrimary, fontWeight: '700' },
});
