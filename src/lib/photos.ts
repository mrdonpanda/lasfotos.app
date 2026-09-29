import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { PHOTOS_BUCKET, photoObjectPath, SIGNED_URL_TTL } from './lotPhotos';
import { supabase } from './supabase';
import type { UploadJob } from './uploadQueue';

async function readLocalBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the photo');
    return response.arrayBuffer();
  }
  return new File(uri).arrayBuffer();
}

/** The path is computed from the car's *current* lot number, never from a value stored at capture time. */
async function currentTarget(job: UploadJob): Promise<string> {
  const { data: car, error } = await supabase
    .from('cars')
    .select('lot_number')
    .eq('id', job.carId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!car) throw new Error('This car was removed');
  return photoObjectPath(job.userId, job.tripId, String(car.lot_number ?? ''), job.angle);
}

export async function uploadJpeg(job: UploadJob, jpegUri: string): Promise<void> {
  const path = await currentTarget(job);
  if (job.storagePath !== path) {
    const body = await readLocalBytes(jpegUri);
    const { error: uploadError } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, body, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);
    // A retake under a previous lot number leaves an object behind; drop it.
    if (job.storagePath && job.storagePath !== path) {
      await supabase.storage.from(PHOTOS_BUCKET).remove([job.storagePath]);
    }
    job.storagePath = path;

    // The lot number may have changed while we were uploading; follow it.
    const finalPath = await currentTarget(job);
    if (finalPath !== path) {
      const { error: moveError } = await supabase.storage.from(PHOTOS_BUCKET).move(path, finalPath);
      if (moveError) throw new Error(moveError.message);
      job.storagePath = finalPath;
    }
  }

  const { error: rowError } = await supabase.from('photos').upsert(
    {
      user_id: job.userId,
      car_id: job.carId,
      angle: job.angle,
      storage_path: job.storagePath,
    },
    { onConflict: 'car_id,angle' },
  );
  if (rowError) throw new Error(rowError.message);

  if (Platform.OS !== 'web' && jpegUri.includes('upload-queue')) {
    try {
      new File(jpegUri).delete();
    } catch {
      // The gallery falls back to the signed URL once the trip reloads.
    }
  }
}

/** Signed URLs (batch) for the private bucket, keyed by storage path. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return urls;
}
