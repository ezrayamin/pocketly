import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BenchScreen } from '@pocketly/bench-app';
import { TabBar, type TabKey } from './src/components/TabBar';
import { DEV_TOOLS_ENABLED } from './src/devtools';
import { AuthGate, useAppLocked } from './src/features/auth/AuthGate';
import { BiometricSetupScreen } from './src/features/auth/BiometricSetupScreen';
import { DevMenu } from './src/features/devmenu/DevMenu';
import { applyDevLink } from './src/features/devmenu/devLinks';
import { HistoryScreen } from './src/features/history/HistoryScreen';
import { TransactionDetailScreen } from './src/features/history/TransactionDetailScreen';
import { HomeScreen } from './src/features/home/HomeScreen';
import { ProfileScreen } from './src/features/profile/ProfileScreen';
import { applyLaunchArgs, needsSetup, parseLaunchArgs, type LaunchArgs } from './src/launchArgs';
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

function MainApp({ initialTab, lockSkipped = false }: { initialTab: TabKey; lockSkipped?: boolean }) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  // History mounts on first visit, then stays mounted (keeps its list and scroll) like Home.
  const [historyVisited, setHistoryVisited] = useState(initialTab === 'history');
  const [historyScrollToTop, setHistoryScrollToTop] = useState(0);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  // A Modal is its own window, above the lock screen: keep it hidden while locked.
  const locked = useAppLocked();
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
          <ProfileScreen onOpenDevMenu={() => setDevMenuOpen(true)} lockSkipped={lockSkipped} />
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
          <Stack.Screen name="BiometricSetup" component={BiometricSetupScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      {DEV_TOOLS_ENABLED && (
        <DevMenu
          visible={devMenuOpen && !locked}
          lockSkipped={lockSkipped}
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
  launchError: { justifyContent: 'center', padding: 24 },
  launchErrorText: { color: colors.danger, fontSize: 15 },
});

type Launch = { args: LaunchArgs; error?: undefined } | { args?: undefined; error: string };

/**
 * Root. Perf builds may pass benchmark launch arguments (src/launchArgs.ts); they are
 * applied before MainApp mounts, so its first load already sees the requested dataset and
 * network. Bad arguments stop the app with a visible error rather than run with defaults.
 */
function App({ launchArgs }: { launchArgs?: Record<string, string> }) {
  const [launch, setLaunch] = useState<Launch>(() => {
    try {
      return { args: parseLaunchArgs(launchArgs) };
    } catch (e) {
      return { error: String(e) };
    }
  });
  const [ready, setReady] = useState(() => launch.args !== undefined && !needsSetup(launch.args));

  useEffect(() => {
    if (ready || !launch.args) return;
    console.info(`[Pocketly] launch arguments: ${JSON.stringify(launch.args)}`);
    applyLaunchArgs(launch.args).then(
      () => setReady(true),
      (e: unknown) => setLaunch({ error: String(e) }),
    );
  }, [ready, launch]);

  if (launch.error !== undefined) {
    return (
      <View style={[styles.root, styles.launchError]}>
        <Text style={styles.launchErrorText} testID="launch-args-error">
          Launch arguments rejected: {launch.error}
        </Text>
      </View>
    );
  }
  if (!ready) return <View style={styles.root} testID="launch-setup" />;
  if (launch.args.bench && BenchScreen) {
    return (
      <SafeAreaProvider>
        <BenchScreen {...launch.args.bench} />
      </SafeAreaProvider>
    );
  }
  const app = <MainApp initialTab={launch.args.tab ?? 'home'} lockSkipped={launch.args.skipLock === true} />;
  if (launch.args.skipLock) {
    console.info('[Pocketly] skipLock: PIN gate off (benchmark launch argument)');
    return app;
  }
  return <AuthGate>{app}</AuthGate>;
}

export default App;
