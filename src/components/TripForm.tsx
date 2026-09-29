import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Minus, Plus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { colors, components, spacing, touch, typography } from '../../theme';
import { MAX_CARS } from '../lib/angles';
import { addDaysISO, formatLongDate, parseISODate, formatISODate, todayISO } from '../lib/dates';
import { getRecentLocations } from '../lib/recentLocations';
import { BigButton, BigField, ErrorText } from './ui';

export type TripFormValues = { location: string; date: string; carCount: number };

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingHorizontal: spacing.md,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.accent : 'transparent',
        justifyContent: 'center',
      }}
    >
      <Text style={[typography.label, { color: active ? colors.textOnAccent : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Location, date (always explicitly chosen) and car count. */
export function TripForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: TripFormValues;
  submitLabel: string;
  onSubmit: (values: TripFormValues) => Promise<void>;
}) {
  const [location, setLocation] = useState(initial.location);
  const [date, setDate] = useState(initial.date);
  const [countText, setCountText] = useState(String(initial.carCount || ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    void getRecentLocations().then(setRecent);
  }, []);

  const count = Number.parseInt(countText, 10);
  const setCount = (next: number) => setCountText(String(Math.min(MAX_CARS, Math.max(1, next))));

  function pickDate() {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({
      value: date ? parseISODate(date) : new Date(),
      mode: 'date',
      onValueChange: (_event, picked) => setDate(formatISODate(picked)),
    });
  }

  async function submit() {
    setError(null);
    if (!location.trim()) return setError('Enter the location name');
    if (!date) return setError('Choose the trip date');
    if (!Number.isInteger(count) || count < 1 || count > MAX_CARS) {
      return setError(`Car count must be 1 to ${MAX_CARS}`);
    }
    setBusy(true);
    try {
      await onSubmit({ location: location.trim(), date, carCount: count });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const today = todayISO();
  return (
    <View style={{ gap: spacing.md }}>
      <BigField label="Location" value={location} onChangeText={setLocation} placeholder="e.g. Buffalo yard" autoCapitalize="words" />
      {recent.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {recent.map((name) => (
            <Chip key={name} label={name} active={name === location} onPress={() => setLocation(name)} />
          ))}
        </View>
      ) : null}

      <View style={{ gap: spacing.xs }}>
        <Text style={typography.label}>Trip date</Text>
        <Pressable
          accessibilityRole="button"
          onPress={pickDate}
          style={[components.input, { justifyContent: 'center' }]}
        >
          <Text style={typography.title}>{date ? formatLongDate(date) : 'Tap to choose a date'}</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Today" active={date === today} onPress={() => setDate(today)} />
          <Chip label="Yesterday" active={date === addDaysISO(today, -1)} onPress={() => setDate(addDaysISO(today, -1))} />
          <Chip label="Tomorrow" active={date === addDaysISO(today, 1)} onPress={() => setDate(addDaysISO(today, 1))} />
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={typography.label}>Cars on this load</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fewer cars"
            onPress={() => setCount((Number.isInteger(count) ? count : 2) - 1)}
            style={stepper}
          >
            <Minus color={colors.text} size={36} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <BigField label="" value={countText} onChangeText={(value) => setCountText(value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More cars"
            onPress={() => setCount((Number.isInteger(count) ? count : 0) + 1)}
            style={stepper}
          >
            <Plus color={colors.text} size={36} />
          </Pressable>
        </View>
      </View>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <BigButton label={busy ? 'Saving…' : submitLabel} onPress={() => void submit()} disabled={busy} />
    </View>
  );
}

const stepper = {
  width: touch.button,
  height: touch.button,
  borderRadius: 16,
  borderWidth: 3,
  borderColor: colors.border,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
