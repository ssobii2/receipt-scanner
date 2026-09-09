import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { initDb, type ReceiptRow } from './src/db';
import HomeScreen from './src/screens/HomeScreen';
import EntryScreen from './src/screens/EntryScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import ChartsScreen from './src/screens/ChartsScreen';
import { colors } from './src/theme';

// A real native stack (react-native-screens under the hood) instead of a
// useState union: iOS gets its edge-swipe back gesture and Android's
// hardware/gesture back is handled by the OS stack for free -- neither is
// achievable by swapping React state by hand. Screens keep their plain
// callback props (onAdd, onDone, ...) unchanged; each route below is a thin
// adapter that reads route.params and calls navigation.* on their behalf, so
// the four screen files never need to know navigation exists. 'capture'
// still carries the in-progress `receipt` (when editing) so returning from
// it can re-open 'entry' on the same record with the freshly captured
// imageUri -- draft text typed into other fields before tapping "Add photo"
// is not preserved across that round trip, since EntryScreen unmounts while
// 'capture' is on screen. Not addressed here: no complaints about it yet.
type RootStackParamList = {
  home: undefined;
  entry: { receipt?: ReceiptRow; imageUri?: string } | undefined;
  capture: { receipt?: ReceiptRow } | undefined;
  charts: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function HomeRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'home'>) {
  return (
    <HomeScreen
      onAdd={() => navigation.navigate('entry')}
      onEdit={(receipt) => navigation.navigate('entry', { receipt })}
      onCharts={() => navigation.navigate('charts')}
    />
  );
}

function EntryRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'entry'>) {
  return (
    <EntryScreen
      receipt={route.params?.receipt}
      imageUri={route.params?.imageUri}
      onDone={() => navigation.popTo('home')}
      onCapture={() => navigation.navigate('capture', { receipt: route.params?.receipt })}
    />
  );
}

function CaptureRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'capture'>) {
  return (
    <CaptureScreen
      onCaptured={(uri) =>
        navigation.navigate('entry', { receipt: route.params?.receipt, imageUri: uri })
      }
      onCancel={() => navigation.navigate('entry', { receipt: route.params?.receipt })}
    />
  );
}

function ChartsRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'charts'>) {
  return <ChartsScreen onBack={() => navigation.goBack()} />;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

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
  } else {
    content = (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="home" component={HomeRoute} />
          <Stack.Screen name="entry" component={EntryRoute} />
          <Stack.Screen name="capture" component={CaptureRoute} />
          <Stack.Screen name="charts" component={ChartsRoute} />
        </Stack.Navigator>
      </NavigationContainer>
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
