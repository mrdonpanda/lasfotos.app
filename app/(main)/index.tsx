import { useFocusEffect, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';

import { colors, components, spacing, typography } from '../../theme';
import { BigButton, Body, ErrorText, Loading, PendingBanner, Screen, Title } from '../../src/components/ui';
import { deleteTrip, listTrips, type TripSummary } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { formatTripDay } from '../../src/lib/dates';
import { useUploadJobs, useUploadQueue } from '../../src/lib/queueContext';
import { getLocalCopyEnabled, setLocalCopyEnabled } from '../../src/lib/settings';
import { supabase } from '../../src/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const queue = useUploadQueue();
  const jobs = useUploadJobs();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localCopy, setLocalCopy] = useState(true);
  const userId = session?.user.id ?? '';

  const load = useCallback(async () => {
    try {
      setTrips(await listTrips());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load trips');
      setTrips((current) => current ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    void getLocalCopyEnabled().then(setLocalCopy);
  }, []);

  useEffect(() => queue.onUploaded(() => void load()), [queue, load]);

  function confirmDelete(trip: TripSummary) {
    Alert.alert(
      `Delete ${trip.location_name}?`,
      `This removes the trip, its ${trip.carCount} cars and ${trip.photoCount} uploaded photos. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            queue.cancelTrip(trip.id);
            deleteTrip(userId, trip.id)
              .then(load)
              .catch((err: Error) => setError(err.message));
          },
        },
      ],
    );
  }

  function signOut() {
    if (jobs.length > 0) {
      Alert.alert(
        'Photos still uploading',
        `${jobs.length} photo${jobs.length === 1 ? '' : 's'} haven't reached the cloud yet. Stay signed in until the banner clears so nothing is lost.`,
      );
      return;
    }
    void supabase.auth.signOut();
  }

  async function toggleLocalCopy(value: boolean) {
    setLocalCopy(value);
    await setLocalCopyEnabled(value);
  }

  if (trips === null) return <Loading label="Loading trips" />;

  return (
    <Screen
      footer={
        <>
          <BigButton
            label="Start New Trip"
            onPress={() => router.push('/trip/new')}
            icon={<Plus color={colors.textOnAccent} size={32} />}
          />
          <BigButton label="Sign Out" tone="secondary" onPress={signOut} />
        </>
      }
    >
      <PendingBanner />
      <Title>Trips</Title>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {trips.length === 0 ? <Body muted>No trips yet. Start one when the load is assigned.</Body> : null}
      {trips.map((trip) => (
        <Pressable
          key={trip.id}
          accessibilityRole="button"
          onPress={() => router.push(`/trip/${trip.id}`)}
          onLongPress={() => confirmDelete(trip)}
          delayLongPress={450}
          style={({ pressed }) => [components.card, { gap: spacing.xs, opacity: pressed ? 0.75 : 1 }]}
        >
          <Text style={typography.title}>{trip.location_name}</Text>
          <Text style={typography.label}>{formatTripDay(trip.trip_date)}</Text>
          <Text style={typography.body}>
            {trip.lotCount}/{trip.carCount} lots · {trip.photoCount}/{trip.carCount * 7} photos
          </Text>
        </Pressable>
      ))}
      {trips.length > 0 ? <Body muted>Long-press a trip to delete it.</Body> : null}
      <View style={[components.card, { flexDirection: 'row', alignItems: 'center', gap: spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={typography.body}>Keep a copy in Files</Text>
          <Text style={typography.label}>Saves each photo to the LasFotos album on this phone</Text>
        </View>
        <Switch
          value={localCopy}
          onValueChange={(value) => void toggleLocalCopy(value)}
          trackColor={{ false: colors.borderMuted, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>
    </Screen>
  );
}
