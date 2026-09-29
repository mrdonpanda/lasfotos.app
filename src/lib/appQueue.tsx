import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { compressPhoto } from './compress';
import { localCopyName } from './lotPhotos';
import { saveToPhotoAlbum } from './deviceAlbum';
import { uploadJpeg } from './photos';
import { UploadQueueProvider, useUploadQueue } from './queueContext';
import { getLocalCopyEnabled } from './settings';
import { supabase } from './supabase';
import { createUploadQueue, type QueueStorage, type UploadJob, type UploadQueue } from './uploadQueue';

function asyncStorageQueue(userId: string): QueueStorage {
  const key = `lasfotos-upload-queue:${userId}`;
  return {
    async load() {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as UploadJob[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async save(jobs) {
      await AsyncStorage.setItem(key, JSON.stringify(jobs));
    },
  };
}

export function createAppUploadQueue(userId: string) {
  return createUploadQueue({
    compress: (job) => compressPhoto(job.localUri, job.width, job.height),
    saveLocal: async (job, jpegUri) => {
      if (!(await getLocalCopyEnabled())) return;
      await saveToPhotoAlbum(jpegUri, localCopyName(job.lotNumber ?? '', job.angle));
    },
    upload: async (job, jpegUri) => {
      try {
        await uploadJpeg(job, jpegUri);
      } catch (err) {
        // An expired session looks like an upload failure; refresh so the backoff retry succeeds.
        if (err instanceof Error && /jwt|token|unauthori|401|expired/i.test(err.message)) {
          await supabase.auth.refreshSession();
        }
        throw err;
      }
    },
    storage: asyncStorageQueue(userId),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
}

/** Retry immediately when the network returns or the app comes back to the foreground. */
function QueueTriggers({ queue }: { queue: UploadQueue }) {
  useEffect(() => {
    let wasOnline = true;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online && !wasOnline) queue.retryNow();
      wasOnline = online;
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') queue.retryNow();
    });
    return () => {
      unsubscribeNet();
      appState.remove();
    };
  }, [queue]);
  return null;
}

export function AppQueueProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const queue = useMemo(() => createAppUploadQueue(userId), [userId]);
  return (
    <UploadQueueProvider queue={queue}>
      <QueueTriggers queue={queue} />
      {children}
    </UploadQueueProvider>
  );
}

export { useUploadQueue };
