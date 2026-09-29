import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { colors } from '../../theme';
import { CameraViewfinder, type Shot } from '../../src/components/CameraViewfinder';
import { ANGLES, nextMissingAngle, photoKey, type Angle } from '../../src/lib/angles';
import { listCarPhotos } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useUploadQueue } from '../../src/lib/queueContext';

/**
 * /camera?tripId=…&carId=…&angle=…&lot=…
 * Each shot goes straight to the offline queue, then the viewfinder advances
 * to the next angle that is still missing; after the last one it closes.
 */
export default function CameraScreen() {
  const params = useLocalSearchParams<{ tripId: string; carId: string; angle: Angle; lot: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const queue = useUploadQueue();
  const userId = session?.user.id ?? '';
  const [angle, setAngle] = useState<Angle>(params.angle);
  const [done, setDone] = useState<Set<Angle>>(new Set());
  const doneRef = useRef(done);
  doneRef.current = done;

  // Angles that already have a photo or a queued upload for this car.
  useEffect(() => {
    let live = true;
    listCarPhotos(params.carId)
      .then((rows) => {
        if (!live) return;
        const next = new Set<Angle>(rows.map((row) => row.angle));
        for (const job of queue.list()) if (job.carId === params.carId) next.add(job.angle);
        setDone((current) => new Set([...current, ...next]));
      })
      .catch(() => undefined); // offline: the queue below still tells us what was shot
    return () => {
      live = false;
    };
  }, [params.carId, queue]);

  function handleShot(photo: Shot) {
    const key = photoKey(params.carId, angle);
    queue.enqueue({
      id: key,
      localUri: photo.uri,
      width: photo.width,
      height: photo.height,
      fileName: `${angle}.jpg`,
      lotNumber: params.lot,
      carId: params.carId,
      tripId: params.tripId,
      userId,
      angle,
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const nextDone = new Set(doneRef.current).add(angle);
    setDone(nextDone);
    const next = nextMissingAngle(nextDone, angle);
    if (next) setAngle(next);
    else router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <CameraViewfinder
        lotNumber={params.lot}
        angle={angle}
        doneAngles={done}
        onSelectAngle={setAngle}
        onShot={handleShot}
        onClose={() => router.back()}
      />
    </View>
  );
}
