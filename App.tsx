import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDb, type ReceiptRow } from './src/db';
import HomeScreen from './src/screens/HomeScreen';
import EntryScreen from './src/screens/EntryScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import { colors } from './src/theme';

// No expo-router / react-navigation: three screens, no deep-linking need,
// so a discriminated union in useState is the whole nav stack. 'capture'
// carries the in-progress `receipt` (when editing) so returning from it can
// re-open 'entry' on the same record with the freshly captured imageUri --
// draft text typed into other fields before tapping "Add photo" is not
// preserved across that round trip, since EntryScreen unmounts while
// 'capture' is on screen. Not addressed here: no complaints about it yet.
type Screen =
  | { name: 'home' }
  | { name: 'entry'; receipt?: ReceiptRow; imageUri?: string }
  | { name: 'capture'; receipt?: ReceiptRow };

export default function App() {
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  useEffect(() => {
    initDb()
      .then(() => setLoading(false))
      .catch((e: unknown) => {
        setDbError(String(e));
        setLoading(false);
      });
  }, []);

  let content;
  if (loading) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  } else if (dbError) {
    content = (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to open database: {dbError}</Text>
      </View>
    );
  } else if (screen.name === 'home') {
    content = (
      <HomeScreen
        onAdd={() => setScreen({ name: 'entry' })}
        onEdit={(receipt) => setScreen({ name: 'entry', receipt })}
      />
    );
  } else if (screen.name === 'entry') {
    content = (
      <EntryScreen
        receipt={screen.receipt}
        imageUri={screen.imageUri}
        onDone={() => setScreen({ name: 'home' })}
        onCapture={() => setScreen({ name: 'capture', receipt: screen.receipt })}
      />
    );
  } else {
    content = (
      <CaptureScreen
        onCaptured={(uri) => setScreen({ name: 'entry', receipt: screen.receipt, imageUri: uri })}
        onCancel={() => setScreen({ name: 'entry', receipt: screen.receipt })}
      />
    );
  }

  return (
    <SafeAreaProvider>
      {content}
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  errorText: { color: colors.danger, fontSize: 14, padding: 24, textAlign: 'center' },
});
