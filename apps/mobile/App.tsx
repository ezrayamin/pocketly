import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabBar, type TabKey } from './src/components/TabBar';
import { DEV_TOOLS_ENABLED } from './src/devtools';
import { DevMenu } from './src/features/devmenu/DevMenu';
import { applyDevLink } from './src/features/devmenu/devLinks';
import { HomeScreen } from './src/features/home/HomeScreen';
import { ProfileScreen } from './src/features/profile/ProfileScreen';
import { colors } from './src/theme/tokens';

function App() {
  const [tab, setTab] = useState<TabKey>('home');
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  // Bumped when the developer menu closes, so Home reloads from the (changed) backend.
  const [homeRefresh, setHomeRefresh] = useState(0);

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

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {/* Home stays mounted (keeps its state and scroll) while Profile is shown. */}
        <View style={[styles.screen, tab !== 'home' && styles.hidden]}>
          <HomeScreen refreshToken={homeRefresh} />
        </View>
        {tab === 'profile' && (
          <View style={styles.screen}>
            <ProfileScreen onOpenDevMenu={() => setDevMenuOpen(true)} />
          </View>
        )}
        <TabBar active={tab} onSelect={setTab} />
      </View>
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
