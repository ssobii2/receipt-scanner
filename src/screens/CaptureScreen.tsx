// Capture/pick an image, persist it permanently, and hand the resulting path
// back to the caller. Owns no confirm/preview step of its own -- that lives
// in EntryScreen, which shows the thumbnail and offers "Remove photo".
import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { persistImage } from '../lib/images';
import { colors } from '../theme';

type Props = {
  onCaptured: (uri: string) => void;
  onCancel: () => void;
};

export default function CaptureScreen({ onCaptured, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  async function openCamera() {
    setError(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setError('Camera permission denied. You can still choose from the gallery.');
        return;
      }
    }
    setShowCamera(true);
  }

  async function takePhoto() {
    try {
      const photo = await cameraRef.current?.takePictureAsync();
      setShowCamera(false);
      if (!photo) return;
      const saved = await persistImage(photo.uri);
      onCaptured(saved);
    } catch (e) {
      setShowCamera(false);
      setError(`Failed to capture photo: ${String(e)}`);
    }
  }

  async function pickImage() {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('Gallery permission denied.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync();
      if (result.canceled) return;
      const saved = await persistImage(result.assets[0].uri);
      onCaptured(saved);
    } catch (e) {
      setError(`Failed to pick image: ${String(e)}`);
    }
  }

  if (showCamera) {
    return (
      <View style={styles.flex}>
        <CameraView ref={cameraRef} style={styles.flex} facing="back" />
        <View style={styles.cameraControls}>
          <Pressable style={styles.button} onPress={takePhoto}>
            <Text style={styles.buttonText}>Capture</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => setShowCamera(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Add photo</Text>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={openCamera}>
          <Text style={styles.buttonText}>Take photo</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={pickImage}>
          <Text style={styles.buttonText}>Choose image</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.cancelLink} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 12 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: { color: colors.accentText, fontSize: 15, fontWeight: '500' },
  cameraControls: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  error: { color: colors.danger, marginTop: 12, fontSize: 14 },
  cancelLink: { marginTop: 24 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
