// Camera/gallery URIs point into the OS cache directory, which iOS can
// reclaim at any time. persistImage copies the file into permanent app
// storage (Paths.document) so a stored path never rots.
import { File, Directory, Paths } from 'expo-file-system';

function receiptsDir(): Directory {
  const dir = new Directory(Paths.document, 'receipts');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function extensionOf(uri: string): string {
  const ext = new File(uri).extension;
  return ext || '.jpg';
}

export async function persistImage(sourceUri: string): Promise<string> {
  const dir = receiptsDir();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extensionOf(sourceUri)}`;
  const dest = new File(dir, filename);
  await new File(sourceUri).copy(dest);
  return dest.uri;
}

export async function deleteImage(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}
