import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text } from 'react-native';

import { touch, typography } from '../theme';
import { BigButton, BigField, Body, ErrorText, Loading, Screen, Title } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { PRIVACY_URL } from '../src/lib/links';
import { supabase, supabaseConfigured } from '../src/lib/supabase';

export default function SignInScreen() {
  const { session, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <Loading label="Loading" />;
  if (session) return <Redirect href="/" />;

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) setError(signInError.message);
  }

  function openPrivacyPolicy() {
    Linking.openURL(PRIVACY_URL).catch(() => setError('Could not open the privacy policy. Visit lasfotos.app/privacy in a browser.'));
  }

  return (
    <Screen>
      <Title>LasFotos</Title>
      <Body muted>Sign in to log lots and photograph every car.</Body>
      {!supabaseConfigured() ? (
        <ErrorText>Supabase URL and key are missing from the app config (.env).</ErrorText>
      ) : null}
      <BigField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
      />
      <BigField
        label="Password"
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        secureTextEntry
        placeholder="Password"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <BigButton label={busy ? 'Working…' : 'Sign in'} onPress={() => void signIn()} disabled={busy} />
      <Body muted>Accounts are created by your administrator.</Body>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Privacy Policy"
        onPress={openPrivacyPolicy}
        style={{ minHeight: touch.min, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[typography.label, { textDecorationLine: 'underline' }]}>Privacy Policy</Text>
      </Pressable>
    </Screen>
  );
}
