import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import Marker, { ImageFormat, Position, TextBackgroundType } from 'react-native-image-marker';

import { watermark } from '../../theme';
import { resizeToMaxEdge } from './resize';
import { watermarkMetrics } from './watermark';

/** Native module paths come back without a scheme; expo-file-system wants a file:// URI. */
function asFileUri(path: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `file://${path}`;
}

/**
 * Stamp `label` into the bottom right corner and encode the final JPEG (the only lossy encode of the
 * pipeline). Throws when the native module is missing, so a photo is never stored without its stamp.
 */
async function stampLabel(uri: string, width: number, height: number, label: string): Promise<string> {
  const m = watermarkMetrics(width, height);
  const result = await Marker.markText({
    backgroundImage: { src: uri },
    watermarkTexts: [
      {
        text: label,
        position: { position: Position.bottomRight, X: m.inset, Y: m.inset },
        style: {
          color: watermark.textColor,
          fontSize: m.fontSize,
          bold: true,
          maxWidth: '92%',
          wrap: 'word',
          shadowStyle: { dx: 0, dy: Math.max(1, Math.round(m.fontSize / 16)), radius: Math.max(2, Math.round(m.fontSize / 12)), color: watermark.shadowColor },
          textBackgroundStyle: {
            type: TextBackgroundType.none,
            color: watermark.boxColor,
            paddingX: m.paddingX,
            paddingY: m.paddingY,
          },
        },
      },
    ],
    saveFormat: ImageFormat.jpg,
    quality: watermark.jpegQuality,
  });
  return asFileUri(result.uri);
}

/**
 * capture -> resize to 1600 px (EXIF orientation applied) -> stamp "{lot} {Angle}" -> JPEG q80 ->
 * app storage. The returned file is what the device album gets and what is uploaded.
 */
export async function compressPhoto(
  uri: string,
  width: number,
  height: number,
  label: string,
): Promise<{ uri: string; width: number; height: number }> {
  const size = resizeToMaxEdge(width, height, 1600);
  const actions = size ? [{ resize: size }] : [];
  // Native web has no marker module; on Android the intermediate is re-encoded once by the stamp step.
  const resized = await manipulateAsync(uri, actions, {
    compress: Platform.OS === 'web' ? 0.8 : 1,
    format: SaveFormat.JPEG,
  });
  if (Platform.OS === 'web') {
    return { uri: resized.uri, width: resized.width, height: resized.height };
  }
  const stamped = await stampLabel(resized.uri, resized.width, resized.height, label);
  try {
    new File(resized.uri).delete(); // the unstamped intermediate
  } catch {
    // the OS clears the cache eventually
  }
  const dir = new Directory(Paths.document, 'upload-queue');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  await new File(stamped).copy(dest);
  try {
    new File(stamped).delete();
  } catch {
    // ditto
  }
  return { uri: dest.uri, width: resized.width, height: resized.height };
}
