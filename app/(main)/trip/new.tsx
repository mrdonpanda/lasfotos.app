import { useRouter } from 'expo-router';

import { BackButton, Screen, Title } from '../../../src/components/ui';
import { TripForm } from '../../../src/components/TripForm';
import { DEFAULT_CAR_COUNT } from '../../../src/lib/angles';
import { createTrip } from '../../../src/lib/api';
import { rememberLocation } from '../../../src/lib/recentLocations';

export default function NewTripScreen() {
  const router = useRouter();
  return (
    <Screen>
      <BackButton />
      <Title>New trip</Title>
      <TripForm
        // The date starts empty on purpose: the driver picks it (or taps Today) every time.
        initial={{ location: '', date: '', carCount: DEFAULT_CAR_COUNT }}
        submitLabel="Create trip"
        onSubmit={async (values) => {
          const id = await createTrip(values);
          await rememberLocation(values.location);
          router.replace(`/trip/${id}`);
        }}
      />
    </Screen>
  );
}
