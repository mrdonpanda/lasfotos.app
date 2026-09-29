import { Redirect, Stack } from 'expo-router';

import { colors } from '../../theme';
import { Loading } from '../../src/components/ui';
import { AppQueueProvider } from '../../src/lib/appQueue';
import { useAuth } from '../../src/lib/auth';

export default function MainLayout() {
  const { session, ready } = useAuth();
  if (!ready) return <Loading label="Loading" />;
  if (!session) return <Redirect href="/sign-in" />;
  return (
    <AppQueueProvider userId={session.user.id}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </AppQueueProvider>
  );
}
