// Downscales a copy of the photo for upload only -- the persisted receipt
// photo (src/lib/images.ts) stays full-resolution. A 12MP iPhone photo
// base64-encodes to 5-8MB, which can sit near extractReceiptLive's 15s
// timeout on mobile data and get reported as "offline". A 130-item receipt
// still reads perfectly at 160px wide, so 1600px is generous headroom.
import { File } from 'expo-file-system';
import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.7;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// readBase64 implementation for extractReceiptLive: reads (and if needed,
// downscales) the file at `uri` and returns its base64 contents.
export async function readUploadBase64(uri: string): Promise<string> {
  try {
    const { width, height } = await getImageSize(uri);
    if (Math.max(width, height) <= MAX_EDGE) {
      return await new File(uri).base64();
    }

    const context =
      width >= height
        ? ImageManipulator.manipulate(uri).resize({ width: MAX_EDGE })
        : ImageManipulator.manipulate(uri).resize({ height: MAX_EDGE });
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ base64: true, compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    context.release();
    rendered.release();

    // saveAsync wrote a JPEG into the cache directory; we already have its
    // base64 in hand, so don't leave the temp file sitting around.
    try {
      const tempFile = new File(result.uri);
      if (tempFile.exists) tempFile.delete();
    } catch {
      // best-effort cleanup -- a stray cache file isn't worth failing the upload for.
    }

    if (!result.base64) throw new Error('image manipulator returned no base64');
    return result.base64;
  } catch {
    // Resizing failed for any reason -- a large upload that might time out
    // is still better than no attempt at all.
    return await new File(uri).base64();
  }
}
