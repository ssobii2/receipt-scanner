// Minimal pipeline-proving screen: capture or pick an image, persist it
// permanently, and show the resulting path. Not final UI.
import { useRef, useState } from 'react';
import { SafeAreaView, View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { persistImage, deleteImage } from '../lib/images';

export default function CaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
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
      setUri(saved);
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
      setUri(saved);
    } catch (e) {
      setError(`Failed to pick image: ${String(e)}`);
    }
  }

  async function clear() {
    try {
      if (uri) await deleteImage(uri);
      setUri(null);
      setError(null);
    } catch (e) {
      setError(`Failed to delete image: ${String(e)}`);
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
      <Text style={styles.title}>Capture Receipt</Text>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={openCamera}>
          <Text style={styles.buttonText}>Take photo</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={pickImage}>
          <Text style={styles.buttonText}>Choose image</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {uri && (
        <View style={styles.result}>
          <Image source={{ uri }} style={styles.preview} />
          <Text style={styles.path}>{uri}</Text>
          <Pressable style={styles.button} onPress={clear}>
            <Text style={styles.buttonText}>Clear</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 12 },
  button: {
    backgroundColor: '#222',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  cameraControls: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  error: { color: '#c0392b', marginTop: 12, fontSize: 14 },
  result: { marginTop: 20, gap: 8, alignItems: 'flex-start' },
  preview: { width: 220, height: 220, borderRadius: 8, backgroundColor: '#eee' },
  path: { fontFamily: 'monospace', fontSize: 11, color: '#444' },
});
