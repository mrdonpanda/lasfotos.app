import { Directory, File, Paths } from 'expo-file-system';
import Share from 'react-native-share';

import { type Angle } from './angles';
import { localCopyName } from './lotPhotos';

export type ShareItem = {
  /** A local file:// URI (photo still waiting to upload) or a signed https URL (already uploaded). */
  uri: string;
  lot: string;
  angle: Angle;
};

const SHARE_DIR_PREFIX = 'share-';

/** "48215901_front.jpg"; a repeated name (e.g. two cars without a lot number) gets "-2", "-3"... */
export function shareFileNames(items: readonly Pick<ShareItem, 'lot' | 'angle'>[]): string[] {
  const used = new Map<string, number>();
  return items.map((item) => {
    const name = localCopyName(item.lot, item.angle);
    const count = (used.get(name) ?? 0) + 1;
    used.set(name, count);
    return count === 1 ? name : name.replace(/\.jpg$/, `-${count}.jpg`);
  });
}

export const isLocalUri = (uri: string) => uri.startsWith('file:') || uri.startsWith('/');

/** Old temporary share folders are removed here (not right after sharing: the receiving app may still be reading). */
export function cleanupShareFolders(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof Directory && entry.name.startsWith(SHARE_DIR_PREFIX)) entry.delete();
    }
  } catch {
    // best effort; the OS clears the cache when space is needed
  }
}

/**
 * Puts every selected photo into one temporary folder (copying local files, downloading uploaded ones through their
 * signed URLs), then opens the Android share sheet ONCE with all of them (ACTION_SEND_MULTIPLE).
 * expo-sharing can only share a single file, which is why react-native-share is used here.
 */
export async function sharePhotos(items: readonly ShareItem[], onProgress?: (done: number, total: number) => void): Promise<void> {
  if (items.length === 0) return;
  cleanupShareFolders();
  const dir = new Directory(Paths.cache, `${SHARE_DIR_PREFIX}${Date.now()}`);
  dir.create({ intermediates: true, idempotent: true });
  const names = shareFileNames(items);
  const uris: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const dest = new File(dir, names[i]);
    if (isLocalUri(items[i].uri)) {
      new File(items[i].uri).copy(dest);
    } else {
      await File.downloadFileAsync(items[i].uri, dest);
    }
    uris.push(dest.uri);
    onProgress?.(i + 1, items.length);
  }
  await Share.open({
    urls: uris,
    type: 'image/jpeg',
    title: 'Share photos',
    failOnCancel: false, // closing the sheet is not an error
  });
}
