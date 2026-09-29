import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { BackButton, Body, ErrorText, Loading, Screen, Title } from '../../../../src/components/ui';
import { TripForm } from '../../../../src/components/TripForm';
import { addCars, getTrip, listCars, listTripPhotos, removeCars, updateTrip, type Car, type PhotoRow, type Trip } from '../../../../src/lib/api';
import { useAuth } from '../../../../src/lib/auth';
import { useUploadQueue } from '../../../../src/lib/queueContext';
import { rememberLocation } from '../../../../src/lib/recentLocations';

function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Remove cars', style: 'destructive', onPress: () => resolve(true) },
    ], { onDismiss: () => resolve(false) });
  });
}

export default function EditTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const queue = useUploadQueue();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getTrip(id), listCars(id), listTripPhotos(id)])
      .then(([t, c, p]) => {
        setTrip(t);
        setCars(c);
        setPhotos(p);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (!trip) {
    return error ? (
      <Screen><BackButton /><ErrorText>{error}</ErrorText></Screen>
    ) : (
      <Loading label="Loading trip" />
    );
  }

  return (
    <Screen>
      <BackButton />
      <Title>Edit trip</Title>
      <Body muted>Raising the car count adds blank cars. Lowering it removes cars from the end.</Body>
      <TripForm
        initial={{ location: trip.location_name, date: trip.trip_date, carCount: cars.length }}
        submitLabel="Save changes"
        onSubmit={async (values) => {
          const userId = session?.user.id ?? '';
          const sorted = [...cars].sort((a, b) => a.position - b.position);
          if (values.carCount < sorted.length) {
            const doomed = sorted.slice(values.carCount);
            const withPhotos = doomed.filter(
              (car) => photos.some((p) => p.car_id === car.id) || queue.list().some((job) => job.carId === car.id),
            );
            if (withPhotos.length > 0) {
              const lots = withPhotos.map((car) => car.lot_number ?? `car ${car.position}`).join(', ');
              const ok = await confirm('Cars have photos', `Removing these cars deletes their photos too: ${lots}.`);
              if (!ok) return;
            }
            for (const car of doomed) queue.cancelCar(car.id);
            await removeCars(doomed.map((car) => car.id));
          } else if (values.carCount > sorted.length) {
            const last = sorted.length ? sorted[sorted.length - 1].position : 0;
            await addCars({ id, userId }, last + 1, values.carCount - sorted.length);
          }
          await updateTrip(id, { location: values.location, date: values.date });
          await rememberLocation(values.location);
          router.back();
        }}
      />
    </Screen>
  );
}
