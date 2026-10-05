import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabBar, type TabKey } from './src/components/TabBar';
import { DEV_TOOLS_ENABLED } from './src/devtools';
import { DevMenu } from './src/features/devmenu/DevMenu';
import { applyDevLink } from './src/features/devmenu/devLinks';
import { HistoryScreen } from './src/features/history/HistoryScreen';
import { TransactionDetailScreen } from './src/features/history/TransactionDetailScreen';
import { HomeScreen } from './src/features/home/HomeScreen';
import { ProfileScreen } from './src/features/profile/ProfileScreen';
import type { RootStackParamList } from './src/navigation';
import { colors } from './src/theme/tokens';

const Stack = createNativeStackNavigator<RootStackParamList>();

const NAV_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
  },
};

function App() {
  const [tab, setTab] = useState<TabKey>('home');
  // History mounts on first visit, then stays mounted (keeps its list and scroll) like Home.
  const [historyVisited, setHistoryVisited] = useState(false);
  const [historyScrollToTop, setHistoryScrollToTop] = useState(0);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  // Bumped when the developer menu closes or a dev link changes the backend, so Home and
  // History reload from it.
  const [homeRefresh, setHomeRefresh] = useState(0);

  const selectTab = (next: TabKey) => {
    if (next === tab) {
      // product.md §7.3 rule 5: tapping the active tab again scrolls its list to the top.
      if (next === 'history') setHistoryScrollToTop((n) => n + 1);
      return;
    }
    if (next === 'history') setHistoryVisited(true);
    setTab(next);
  };

  // pocketly://dev/... links (ADR-0008): scriptable dev controls for Maestro and runners.
  useEffect(() => {
    if (!DEV_TOOLS_ENABLED) return;
    const handle = (url: string | null | undefined) => {
      if (!url) return;
      applyDevLink(url).then(
        (result) => {
          if (!result) return;
          console.info(`[Pocketly] dev link ${result.action}: ${result.detail}`);
          setHomeRefresh((n) => n + 1);
        },
        (e: unknown) => console.warn(`[Pocketly] dev link rejected: ${url}`, e),
      );
    };
    Linking.getInitialURL().then(handle, () => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  const tabs = () => (
    <View style={styles.root}>
      {/* Home stays mounted (keeps its state and scroll) while another tab is shown. */}
      <View style={[styles.screen, tab !== 'home' && styles.hidden]}>
        <HomeScreen refreshToken={homeRefresh} onSeeAll={() => selectTab('history')} />
      </View>
      {historyVisited && (
        <View style={[styles.screen, tab !== 'history' && styles.hidden]}>
          <HistoryScreen reloadToken={homeRefresh} scrollToTopToken={historyScrollToTop} />
        </View>
      )}
      {tab === 'profile' && (
        <View style={styles.screen}>
          <ProfileScreen onOpenDevMenu={() => setDevMenuOpen(true)} />
        </View>
      )}
      <TabBar active={tab} onSelect={selectTab} />
    </View>
  );

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={NAV_THEME}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="Tabs">{tabs}</Stack.Screen>
          <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      {DEV_TOOLS_ENABLED && (
        <DevMenu
          visible={devMenuOpen}
          onClose={() => {
            setDevMenuOpen(false);
            setHomeRefresh((n) => n + 1);
          }}
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  screen: StyleSheet.absoluteFill,
  // display:none keeps Home mounted but out of layout, touch and the accessibility tree.
  hidden: { display: 'none' },
});

export default App;
