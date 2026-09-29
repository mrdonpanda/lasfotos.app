import { Directory, File, Paths } from 'expo-file-system';
import { Album, Asset, getPermissionsAsync, requestPermissionsAsync, type GranularPermission } from 'expo-media-library';
import { Linking, Platform } from 'react-native';

export const PHOTO_ALBUM = 'LasFotos';

const photoPermission: GranularPermission[] = ['photo'];

export class DeviceAlbumPermissionError extends Error {
  constructor() {
    super('Allow photo storage to keep a copy in the LasFotos album');
    this.name = 'DeviceAlbumPermissionError';
  }
}

export async function ensureDeviceAlbumPermission(openSettings = false): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const current = await getPermissionsAsync(false, photoPermission);
  if (current.granted) return true;
  if (!current.canAskAgain) {
    if (openSettings) await Linking.openSettings();
    return false;
  }
  const next = await requestPermissionsAsync(false, photoPermission);
  return next.granted === true;
}

/** Copy `uri` to a temp file called `fileName` so the album copy is identifiable in Files. */
function namedCopy(uri: string, fileName?: string): { uri: string; cleanup: () => void } {
  if (!fileName) return { uri, cleanup: () => undefined };
  try {
    const dir = new Directory(Paths.cache, 'album-copies');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, fileName);
    if (dest.exists) dest.delete();
    new File(uri).copy(dest);
    return {
      uri: dest.uri,
      cleanup: () => {
        try {
          dest.delete();
        } catch {
          // temp file, the cache is pruned by the OS
        }
      },
    };
  } catch {
    return { uri, cleanup: () => undefined };
  }
}

export async function saveToPhotoAlbum(uri: string, fileName?: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const allowed = await ensureDeviceAlbumPermission();
  if (!allowed) throw new DeviceAlbumPermissionError();
  const copy = namedCopy(uri, fileName);
  try {
    try {
      await addToAlbum(copy.uri);
    } catch (err) {
      const existing = await Album.get(PHOTO_ALBUM);
      if (!existing) throw err;
      await Asset.create(copy.uri, existing);
    }
  } finally {
    copy.cleanup();
  }
}

async function addToAlbum(uri: string): Promise<void> {
  const existing = await Album.get(PHOTO_ALBUM);
  if (existing) {
    await Asset.create(uri, existing);
    return;
  }
  await Album.create(PHOTO_ALBUM, [uri], false);
}
