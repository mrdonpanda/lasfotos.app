import { Redirect } from 'expo-router';
import { useState } from 'react';

import { colors } from '../theme';
import { BigButton, BigField, Body, ErrorText, Loading, Screen, Title } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { supabase, supabaseConfigured } from '../src/lib/supabase';

export default function SignInScreen() {
  const { session, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <Loading label="Loading" />;
  if (session) return <Redirect href="/" />;

  async function signIn() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) setError(signInError.message);
  }

  async function createAccount() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (!data.session) setNotice('Check your email to confirm the account, then sign in.');
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
      {notice ? <Body>{notice}</Body> : null}
      <BigButton label={busy ? 'Working…' : 'Sign in'} onPress={() => void signIn()} disabled={busy} />
      <BigButton label="Create account" tone="secondary" onPress={() => void createAccount()} disabled={busy} />
    </Screen>
  );
}
