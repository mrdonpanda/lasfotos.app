import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Circle, CircleCheck } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, Image, Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { borderWidth, colors, components, radius, spacing, touch, typography } from '../../../../theme';
import { BackButton, BigButton, Body, ErrorText, Loading, PendingBanner, Screen, Title } from '../../../../src/components/ui';
import { angleLabel, ANGLES, type Angle } from '../../../../src/lib/angles';
import { getTrip, listCars, listTripPhotos, type Car, type PhotoRow } from '../../../../src/lib/api';
import { signedUrls } from '../../../../src/lib/photos';
import { useUploadJobs, useUploadQueue } from '../../../../src/lib/queueContext';
import { allSelected, pruneSelection, toggleAll, toggleKey } from '../../../../src/lib/selection';
import { cleanupShareFolders, sharePhotos } from '../../../../src/lib/sharePhotos';

type Shot = { key: string; carId: string; lot: string; note: string; angle: Angle; uri: string | null; pending: boolean };

function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: touch.min,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.lg,
        borderWidth: borderWidth.thick,
        borderColor: colors.border,
      }}
    >
      <Text style={typography.button}>{label}</Text>
    </Pressable>
  );
}

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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState<{ done: number; total: number } | null>(null);

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

  // Only photos with a usable image (local file or signed URL) can be selected.
  const selectable = useMemo(() => shots.filter((shot) => shot.uri).map((shot) => shot.key), [shots]);
  const everythingSelected = allSelected(selectable, selected);

  // Drop selections that no longer exist after a reload (photo retaken, trip changed).
  useEffect(() => {
    setSelected((current) => pruneSelection(current, selectable));
  }, [selectable]);

  // Remove temporary share copies from earlier shares.
  useEffect(() => cleanupShareFolders(), []);

  function exitSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  // The Android back button leaves selection mode first.
  useEffect(() => {
    if (!selecting) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelection();
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  async function shareSelected() {
    const items = shots.filter((shot) => selected.has(shot.key) && shot.uri).map((shot) => ({ uri: shot.uri as string, lot: shot.lot, angle: shot.angle }));
    if (items.length === 0) return;
    setError(null);
    setSharing({ done: 0, total: items.length });
    try {
      await sharePhotos(items, (done, total) => setSharing({ done, total }));
    } catch (err) {
      setError(err instanceof Error ? `Could not share: ${err.message}` : 'Could not share the photos');
    } finally {
      setSharing(null);
    }
  }

  if (!loaded) return <Loading label="Loading photos" />;

  const tile = (width - spacing.md * 2 - spacing.sm) / 2;
  return (
    <Screen
      scroll={false}
      footer={
        selecting && selected.size > 0 ? (
          <BigButton
            label={sharing ? `Preparing ${sharing.done}/${sharing.total}…` : `Share (${selected.size})`}
            onPress={() => void shareSelected()}
            disabled={sharing !== null}
          />
        ) : undefined
      }
    >
      <BackButton label="Trip" />
      <PendingBanner />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Title>{selecting ? `${selected.size} selected` : 'Review'}</Title>
        {selecting ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <HeaderButton label={everythingSelected ? 'Clear' : 'Select all'} onPress={() => setSelected(toggleAll(selectable, selected))} />
            <HeaderButton label="Cancel" onPress={exitSelection} />
          </View>
        ) : shots.length > 0 ? (
          <HeaderButton label="Select" onPress={() => setSelecting(true)} />
        ) : null}
      </View>
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
        extraData={{ selecting, selected }}
        renderItem={({ item, index }) => {
          const isSelected = selected.has(item.key);
          return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={selecting ? { selected: isSelected } : undefined}
            accessibilityLabel={`${item.lot} ${angleLabel(item.angle)}${selecting ? (isSelected ? ', selected' : ', not selected') : ''}`}
            onPress={() => {
              if (!selecting) setViewer(index);
              else if (item.uri) setSelected((current) => toggleKey(current, item.key));
            }}
            onLongPress={() => {
              if (!item.uri) return;
              setSelecting(true);
              setSelected((current) => new Set(current).add(item.key));
            }}
            style={[
              components.card,
              { width: tile, padding: spacing.xs, gap: spacing.xs },
              selecting && isSelected ? { borderWidth: borderWidth.thick, borderColor: colors.accent } : null,
            ]}
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
            {selecting ? (
              <View style={{ position: 'absolute', top: spacing.sm, right: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.pill }}>
                {isSelected ? <CircleCheck color={colors.accent} size={32} /> : <Circle color={colors.text} size={32} />}
              </View>
            ) : null}
          </Pressable>
          );
        }}
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
