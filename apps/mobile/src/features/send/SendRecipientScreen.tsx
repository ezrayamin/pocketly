import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Contact, ContactSearch } from '@pocketly/core-contract';
import { Avatar } from '../../components/Avatar';
import { ChevronRight, Search, UserSearch, WifiOff, X } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { formatPhone } from '../auth/phoneFormat';
import { toUserError, type UserError } from '../errors';
import { PrimaryButton, SendHeader, TextButton, sendStyles } from './components';

type Props = NativeStackScreenProps<RootStackParamList, 'SendRecipient'>;

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Send, step 1: choose a recipient (FR-TRF-01). Recent recipients and the directory come from
 * the core; a typed number is FOUND, NOT_FOUND or SELF. Unreachable server: sending is blocked
 * (FR-TRF-11), balance and history stay available on Home.
 */
export function SendRecipientScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ContactSearch | null>(null);
  const [error, setError] = useState<UserError | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    const timer = setTimeout(
      () => {
        core.searchContacts(query).then(
          (r) => {
            if (ticket !== latest.current) return; // an older search answering late
            setResult(r);
            setError(null);
          },
          (e: unknown) => ticket === latest.current && setError(toUserError(e)),
        );
      },
      query.length === 0 ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query, attempt]);

  const choose = useCallback(
    async (contact: Contact) => {
      if (opening) return;
      setOpening(contact.userId);
      try {
        const draft = await core.startTransfer(contact.userId);
        navigation.navigate('SendAmount', { draft });
      } catch (e) {
        setError(toUserError(e));
      } finally {
        setOpening(null);
      }
    },
    [navigation, opening],
  );

  const offline = error !== null && ['NETWORK_UNAVAILABLE', 'NETWORK_TIMEOUT', 'SERVER_ERROR'].includes(error.code);
  if (offline) {
    return (
      <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="send-offline">
        <StatusBar barStyle="light-content" />
        <SendHeader onBack={() => navigation.goBack()} backLabel="Back to Home" />
        <View style={styles.blocked} accessibilityRole="alert">
          <View style={[styles.bigIcon, styles.warnIcon]}>
            <WifiOff color={colors.tertiary} size={36} />
          </View>
          <Text style={styles.blockedTitle}>{error.offline ? "You're offline" : "Can't reach Pocketly"}</Text>
          <Text style={styles.blockedText}>
            Sending money needs a connection. Your balance and history are still available.
          </Text>
        </View>
        <View style={sendStyles.footer}>
          <PrimaryButton label="Try again" onPress={() => setAttempt((n) => n + 1)} testID="send-offline-retry" />
          <TextButton label="Back to Home" onPress={() => navigation.goBack()} testID="send-offline-home" />
        </View>
      </SafeAreaView>
    );
  }

  const searching = query.trim().length > 0;
  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="send-recipient">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back to Home" />
      <View style={styles.searchBlock}>
        <Text style={styles.label} nativeID="recipient-search-label">
          Name or phone number
        </Text>
        <View style={[styles.search, searching && styles.searchActive]}>
          <Search color={colors.textSecondary} size={20} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. Andi or +62 812…"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabelledBy="recipient-search-label"
            accessibilityLabel="Name or phone number"
            testID="recipient-search"
          />
          {searching && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              testID="recipient-clear"
            >
              <X color={colors.textSecondary} size={18} />
            </Pressable>
          )}
        </View>
        {error && (
          <Text style={styles.inlineError} accessibilityRole="alert" testID="recipient-error">
            {error.message}
          </Text>
        )}
      </View>

      {result === null ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : (
        <ScrollView contentContainerStyle={styles.lists} keyboardShouldPersistTaps="handled">
          {!searching && result.recent.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                Recent
              </Text>
              <View style={styles.recentRow}>
                {result.recent.map((c) => (
                  <Pressable
                    key={c.userId}
                    style={styles.recent}
                    onPress={() => choose(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`Send to ${c.name}`}
                    testID={`recent-${c.userId}`}
                  >
                    <Avatar id={c.userId} name={c.name} size={56} />
                    <Text style={styles.recentName} numberOfLines={1}>
                      {c.name.split(' ')[0]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {result.phoneLookup === 'NOT_FOUND' || result.phoneLookup === 'SELF' ? (
            <View
              style={styles.empty}
              accessibilityRole="alert"
              testID={`recipient-${result.phoneLookup === 'SELF' ? 'self' : 'not-found'}`}
            >
              <View style={styles.bigIcon}>
                <UserSearch color={colors.textSecondary} size={32} />
              </View>
              {result.phoneLookup === 'SELF' ? (
                <>
                  <Text style={styles.emptyTitle}>That's your number</Text>
                  <Text style={styles.emptyText}>You can't send money to yourself.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>We couldn't find this recipient</Text>
                  <Text style={styles.emptyText}>
                    No Pocketly account uses {query.trim()}. Check the number and try again.
                  </Text>
                </>
              )}
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {searching ? 'Results' : 'Contacts'}
              </Text>
              {result.contacts.length === 0 && (
                <Text style={styles.emptyText} testID="recipient-no-match">
                  No contacts match "{query.trim()}".
                </Text>
              )}
              {result.contacts.map((c, i) => (
                <Pressable
                  key={c.userId}
                  style={({ pressed }) => [
                    styles.contact,
                    i < result.contacts.length - 1 && styles.divider,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => choose(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}, ${formatPhone(c.phone)}`}
                  accessibilityState={{ busy: opening === c.userId }}
                  testID={`contact-${c.userId}`}
                >
                  <Avatar id={c.userId} name={c.name} />
                  <View style={styles.contactText}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactPhone}>{formatPhone(c.phone)}</Text>
                  </View>
                  {opening === c.userId ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <ChevronRight color={colors.textMuted} size={18} />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  searchBlock: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md + 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchActive: { borderColor: colors.primary },
  input: { flex: 1, color: colors.textPrimary, fontSize: 16, paddingVertical: spacing.md },
  inlineError: { color: colors.danger, fontSize: 14 },
  loading: { marginTop: 48 },
  lists: { paddingBottom: spacing.xxl },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  recentRow: { flexDirection: 'row', gap: 18 },
  recent: { width: 60, alignItems: 'center', gap: spacing.sm },
  recentName: { color: colors.textSecondary, fontSize: 13 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 6 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { opacity: 0.7 },
  contactText: { flex: 1, gap: 2 },
  contactName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  contactPhone: { color: colors.textSecondary, fontSize: 13 },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 40, paddingTop: 72 },
  bigIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  warnIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.tertiaryDim },
  emptyTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  blocked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  blockedTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  blockedText: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
