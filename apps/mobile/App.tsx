/**
 * Placeholder root: no product UI yet (screens arrive with M2+).
 * It proves the selected core is wired end to end, and loads what Home will load
 * (wallet + 5 recent transactions) so BM-01 measures a realistic first screen.
 */
import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { core } from './src/core';
import { FullyDrawnMarker } from './src/FullyDrawnMarker';

function App() {
  const [balance, setBalance] = useState<string>('…');
  const [recentCount, setRecentCount] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([core.getWallet(), core.getTransactions(undefined, 5)])
      .then(([wallet, recent]) => {
        setBalance(core.formatMoney(wallet.balance));
        setRecentCount(recent.items.length);
      })
      .catch((e: Error) => setBalance(e.message));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.root}>
        <View>
          <Text style={styles.label} accessibilityRole="header">
            Pocketly · core: {core.impl}
          </Text>
          <Text style={styles.value} testID="balance">
            {balance}
          </Text>
          {recentCount !== null && (
            <>
              <Text style={styles.label} testID="recent">
                {recentCount} recent transactions
              </Text>
              <FullyDrawnMarker />
            </>
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  label: { fontSize: 16, color: '#444' },
  value: { fontSize: 32, fontWeight: '600', color: '#111', marginTop: 8 },
});

export default App;
