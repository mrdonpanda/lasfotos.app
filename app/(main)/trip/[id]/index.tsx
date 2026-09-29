import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Images, Pencil } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { colors, components, radius, spacing, touch, typography } from '../../../../theme';
import { AngleTile, type TileState } from '../../../../src/components/AngleTile';
import { BackButton, BigButton, Body, ErrorText, Loading, PendingBanner, Screen, Title } from '../../../../src/components/ui';
import { ANGLES, nextMissingAngle, photoKey, type Angle } from '../../../../src/lib/angles';
import { getTrip, listCars, listTripPhotos, setLotNumber, type Car, type PhotoRow, type Trip } from '../../../../src/lib/api';
import { useAuth } from '../../../../src/lib/auth';
import { formatTripDay } from '../../../../src/lib/dates';
import { useUploadJobs, useUploadQueue } from '../../../../src/lib/queueContext';

export default function TripWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const queue = useUploadQueue();
  const jobs = useUploadJobs();
  const userId = session?.user.id ?? '';

  const [trip, setTrip] = useState<Trip | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [editing, setEditing] = useState<Car | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextTrip, nextCars, nextPhotos] = await Promise.all([getTrip(id), listCars(id), listTripPhotos(id)]);
      setTrip(nextTrip);
      setCars(nextCars);
      setPhotos(nextPhotos);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the trip');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => queue.onUploaded(() => void load()), [queue, load]);

  const photoSet = useMemo(() => new Set(photos.map((p) => photoKey(p.car_id, p.angle))), [photos]);
  const jobByKey = useMemo(() => new Map(jobs.map((job) => [photoKey(job.carId, job.angle), job])), [jobs]);

  function tileState(car: Car, angle: Angle): TileState {
    const key = photoKey(car.id, angle);
    const job = jobByKey.get(key);
    if (job) return job.status === 'failed' ? 'failed' : 'uploading';
    return photoSet.has(key) ? 'captured' : 'empty';
  }

  function doneAngles(car: Car): Set<Angle> {
    return new Set(ANGLES.map((a) => a.id).filter((angle) => tileState(car, angle) !== 'empty'));
  }

  const isComplete = (car: Car) => Boolean(car.lot_number) && doneAngles(car).size === ANGLES.length;

  // Auto-expand the first car that still needs work, once per visit.
  useEffect(() => {
    if (autoExpanded || cars.length === 0) return;
    const next = cars.find((car) => !isComplete(car));
    setExpanded(next?.id ?? null);
    setAutoExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cars, autoExpanded]);

  function shoot(car: Car, angle: Angle) {
    if (!car.lot_number) {
      setEditing(car);
      return;
    }
    if (jobByKey.get(photoKey(car.id, angle))?.status === 'failed') queue.retryNow();
    router.push({
      pathname: '/camera',
      params: { tripId: id, carId: car.id, angle, lot: car.lot_number },
    });
  }

  if (!trip) return error ? <Screen><BackButton /><ErrorText>{error}</ErrorText></Screen> : <Loading label="Loading trip" />;

  const totalPhotos = cars.length * ANGLES.length;
  const donePhotos = cars.reduce((sum, car) => sum + doneAngles(car).size, 0);

  return (
    <Screen
      footer={
        <BigButton
          label="Review Trip"
          onPress={() => router.push(`/trip/${id}/gallery`)}
          icon={<Images color={colors.textOnAccent} size={30} />}
        />
      }
    >
      <BackButton label="Trips" />
      <PendingBanner />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Title>{trip.location_name}</Title>
          <Text style={typography.label}>
            {formatTripDay(trip.trip_date)} · {donePhotos}/{totalPhotos} photos
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit trip"
          onPress={() => router.push(`/trip/${id}/edit`)}
          style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}
        >
          <Pencil color={colors.text} size={30} />
        </Pressable>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {cars.map((car) => {
        const open = expanded === car.id;
        const done = doneAngles(car);
        const complete = isComplete(car);
        return (
          <View key={car.id} style={[components.card, { gap: spacing.md, borderColor: complete ? colors.accent : colors.borderMuted }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => (car.lot_number ? setExpanded(open ? null : car.id) : setEditing(car))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touch.min }}
            >
              <Text style={[typography.label, { width: 32 }]}>{car.position}</Text>
              {car.lot_number ? (
                <View style={{ flex: 1 }}>
                  <Text style={typography.lot}>{car.lot_number}</Text>
                  <Text style={typography.label}>
                    {done.size}/{ANGLES.length} photos{complete ? ' · Done ✓' : ''}
                  </Text>
                </View>
              ) : (
                <View style={[components.lotPlaceholder, { flex: 1 }]}>
                  <Text style={[typography.button, { color: colors.accent }]}>TAP TO ENTER LOT #</Text>
                </View>
              )}
              {car.lot_number ? (
                open ? <ChevronUp color={colors.text} size={32} /> : <ChevronDown color={colors.text} size={32} />
              ) : null}
            </Pressable>

            {car.lot_number && open ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {ANGLES.map((angle) => (
                    <AngleTile
                      key={angle.id}
                      label={angle.label}
                      state={tileState(car, angle.id)}
                      onPress={() => shoot(car, angle.id)}
                    />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {!complete ? (
                    <View style={{ flex: 2 }}>
                      <BigButton
                        label="Shoot next"
                        onPress={() => {
                          const next = nextMissingAngle(done);
                          if (next) shoot(car, next);
                        }}
                      />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <BigButton label="Edit lot" tone="secondary" onPress={() => setEditing(car)} />
                  </View>
                </View>
              </>
            ) : null}
          </View>
        );
      })}

      <LotModal
        car={editing}
        userId={userId}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          setExpanded(saved.id);
          queue.releaseCar(saved.id);
          void load();
        }}
      />
    </Screen>
  );
}

function LotModal({
  car,
  userId,
  onClose,
  onSaved,
}: {
  car: Car | null;
  userId: string;
  onClose: () => void;
  onSaved: (car: Car) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(car?.lot_number ?? '');
    setError(null);
  }, [car]);

  async function save() {
    if (!car) return;
    setBusy(true);
    setError(null);
    try {
      await setLotNumber(car, userId, value);
      onSaved({ ...car, lot_number: value.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the lot number');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={car !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: spacing.md }}>
        <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.accent, padding: spacing.md, gap: spacing.md }}>
          <Text style={typography.title}>Car {car?.position} · lot number</Text>
          <TextInput
            value={value}
            onChangeText={(text) => setValue(text.replace(/[^A-Za-z0-9_.-]/g, ''))}
            keyboardType="number-pad"
            autoFocus
            placeholder="123456"
            placeholderTextColor={colors.borderMuted}
            style={[components.input, { fontSize: 40, fontWeight: '900' }]}
            onSubmitEditing={() => void save()}
          />
          {car?.lot_number ? <Body muted>Changing it renames this car's uploaded photos.</Body> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <BigButton label={busy ? 'Saving…' : 'Save lot number'} onPress={() => void save()} disabled={busy || !value.trim()} />
          <BigButton label="Cancel" tone="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
