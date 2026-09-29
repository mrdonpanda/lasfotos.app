import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { resizeToMaxEdge } from './resize';

export async function compressPhoto(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; width: number; height: number }> {
  const size = resizeToMaxEdge(width, height, 1600);
  const actions = size ? [{ resize: size }] : [];
  const result = await manipulateAsync(uri, actions, {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });
  if (Platform.OS === 'web') {
    return { uri: result.uri, width: result.width, height: result.height };
  }
  const dir = new Directory(Paths.document, 'upload-queue');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  await new File(result.uri).copy(dest);
  return { uri: dest.uri, width: result.width, height: result.height };
}
