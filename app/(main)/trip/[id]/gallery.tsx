import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { colors, components, radius, spacing, typography } from '../../../../theme';
import { BackButton, BigButton, Body, ErrorText, Loading, PendingBanner, Screen, Title } from '../../../../src/components/ui';
import { angleLabel, ANGLES, type Angle } from '../../../../src/lib/angles';
import { getTrip, listCars, listTripPhotos, type Car, type PhotoRow } from '../../../../src/lib/api';
import { signedUrls } from '../../../../src/lib/photos';
import { useUploadJobs, useUploadQueue } from '../../../../src/lib/queueContext';

type Shot = { key: string; carId: string; lot: string; note: string; angle: Angle; uri: string | null; pending: boolean };

export default function GalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useUploadQueue();
  const jobs = useUploadJobs();
  const { width } = useWindowDimensions();
  const [tripNote, setTripNote] = useState('');
  const [cars, setCars] = useState<Car[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextTrip, nextCars, nextPhotos] = await Promise.all([getTrip(id), listCars(id), listTripPhotos(id)]);
      setTripNote(nextTrip.notes ?? '');
      setCars(nextCars);
      setPhotos(nextPhotos);
      setUrls(await signedUrls(nextPhotos.map((p) => p.storage_path)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load photos');
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      // Re-signing on every focus also refreshes URLs that expired while the app was backgrounded.
      void load();
    }, [load]),
  );
  useEffect(() => queue.onUploaded(() => void load()), [queue, load]);

  const shots = useMemo<Shot[]>(() => {
    const lotByCar = new Map(cars.map((car) => [car.id, car.lot_number ?? `Car ${car.position}`]));
    const noteByCar = new Map(cars.map((car) => [car.id, car.notes ?? '']));
    const pendingByKey = new Map(
      jobs.filter((job) => job.tripId === id).map((job) => [`${job.carId}:${job.angle}`, job]),
    );
    const out: Shot[] = [];
    for (const car of cars) {
      for (const angle of ANGLES) {
        const key = `${car.id}:${angle.id}`;
        const job = pendingByKey.get(key);
        const photo = photos.find((p) => p.car_id === car.id && p.angle === angle.id);
        if (job) {
          out.push({ key, carId: car.id, lot: lotByCar.get(car.id) ?? '', note: noteByCar.get(car.id) ?? '', angle: angle.id, uri: job.localUri, pending: true });
        } else if (photo) {
          out.push({ key, carId: car.id, lot: lotByCar.get(car.id) ?? '', note: noteByCar.get(car.id) ?? '', angle: angle.id, uri: urls[photo.storage_path] ?? null, pending: false });
        }
      }
    }
    return out;
  }, [cars, photos, urls, jobs, id]);

  if (!loaded) return <Loading label="Loading photos" />;

  const tile = (width - spacing.md * 2 - spacing.sm) / 2;
  return (
    <Screen scroll={false}>
      <BackButton label="Trip" />
      <PendingBanner />
      <Title>Review</Title>
      {tripNote ? (
        <View style={[components.card, { gap: spacing.xs }]}>
          <Text style={typography.label}>Trip notes</Text>
          <Text style={typography.body}>{tripNote}</Text>
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {shots.length === 0 ? <Body muted>No photos yet.</Body> : null}
      <FlatList
        data={shots}
        keyExtractor={(item) => item.key}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.sm }}
        contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => setViewer(index)}
            style={[components.card, { width: tile, padding: spacing.xs, gap: spacing.xs }]}
          >
            {item.uri ? (
              <Image source={{ uri: item.uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }} />
            ) : (
              <View style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm }} />
            )}
            <Text style={typography.label}>
              {item.lot} · {angleLabel(item.angle)}
            </Text>
            {item.pending ? <Text style={[typography.label, { color: colors.accent }]}>PENDING</Text> : null}
          </Pressable>
        )}
      />
      <Modal visible={viewer !== null} animationType="fade" onRequestClose={() => setViewer(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {viewer !== null ? (
            <FlatList
              data={shots}
              horizontal
              pagingEnabled
              initialScrollIndex={viewer}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => (
                <View style={{ width, flex: 1, justifyContent: 'center' }}>
                  {item.uri ? <Image source={{ uri: item.uri }} resizeMode="contain" style={{ width, height: '80%' }} /> : null}
                  <Text style={[typography.title, { textAlign: 'center', marginTop: spacing.sm }]}>
                    LOT {item.lot} | {angleLabel(item.angle).toUpperCase()}
                    {item.pending ? ' (pending)' : ''}
                  </Text>
                  {item.note ? (
                    <Text style={[typography.body, { textAlign: 'center', color: colors.accent, marginTop: spacing.xs }]}>
                      Note: {item.note}
                    </Text>
                  ) : null}
                </View>
              )}
            />
          ) : null}
          <View style={{ padding: spacing.md }}>
            <BigButton label="Close" tone="secondary" onPress={() => setViewer(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
