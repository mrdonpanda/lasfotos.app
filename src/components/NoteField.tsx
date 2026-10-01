import { AlertTriangle, Check, Loader } from 'lucide-react-native';
import { Pressable, Text, TextInput, View } from 'react-native';

import { borderWidth, colors, components, notes as noteTokens, radius, spacing, typography } from '../../theme';
import type { SaveStatus } from '../lib/autosave';
import { appendQuickNote } from '../lib/notes';
import { useAutosave } from '../lib/useAutosave';

/** "Saving… / Saved / Not saved, tap to retry": always an icon AND words. */
export function SaveStatusLine({ status, error, onRetry }: { status: SaveStatus; error: string | null; onRetry: () => void }) {
  if (status === 'idle') return <View style={{ height: noteTokens.statusFontSize + 6 }} />;
  const base = { fontSize: noteTokens.statusFontSize, fontWeight: '700' as const };
  if (status === 'saving')
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Loader color={colors.textMuted} size={noteTokens.statusFontSize + 2} />
        <Text style={[base, { color: colors.textMuted }]}>Saving…</Text>
      </View>
    );
  if (status === 'saved')
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Check color={colors.success} size={noteTokens.statusFontSize + 2} />
        <Text style={[base, { color: colors.success }]}>Saved</Text>
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Note not saved, tap to retry"
      onPress={onRetry}
      hitSlop={12}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
    >
      <AlertTriangle color={colors.danger} size={noteTokens.statusFontSize + 2} />
      <Text style={[base, { color: colors.danger }]}>Not saved{error ? `: ${error}` : ''} · tap to retry</Text>
    </Pressable>
  );
}

/**
 * A note input with autosave. `multiline` = trip note (taller box); single line = lot note, which
 * also shows tap-to-add quick-note chips.
 */
export function NoteField({
  initial,
  maxLength,
  multiline = false,
  placeholder,
  save,
  chips,
  autoFocus = false,
  label,
}: {
  initial: string;
  maxLength: number;
  multiline?: boolean;
  placeholder: string;
  save: (text: string) => Promise<void>;
  chips?: readonly string[];
  autoFocus?: boolean;
  label?: string;
}) {
  const { text, onChange, flush, status, error, retry } = useAutosave(initial, save);
  return (
    <View style={{ gap: spacing.sm }}>
      {label ? <Text style={typography.label}>{label}</Text> : null}
      <TextInput
        value={text}
        onChangeText={(value) => onChange(value.slice(0, maxLength))}
        onBlur={() => void flush()}
        onEndEditing={() => void flush()}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.borderMuted}
        accessibilityLabel={label ?? placeholder}
        maxLength={maxLength}
        style={{
          minHeight: multiline ? noteTokens.tripInputMinHeight : components.input.minHeight,
          borderWidth: borderWidth.thin,
          borderColor: colors.borderMuted,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          fontSize: noteTokens.inputFontSize,
          color: colors.text,
          backgroundColor: colors.surfaceRaised,
        }}
      />
      {chips ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {chips.map((chip) => (
            <Pressable
              key={chip}
              accessibilityRole="button"
              accessibilityLabel={`Add note: ${chip}`}
              onPress={() => {
                onChange(appendQuickNote(text, chip, maxLength));
                void flush();
              }}
              style={({ pressed }) => ({
                minHeight: noteTokens.chipMinHeight,
                paddingHorizontal: spacing.md,
                justifyContent: 'center',
                borderRadius: radius.pill,
                borderWidth: borderWidth.thin,
                borderColor: colors.accent,
                backgroundColor: pressed ? colors.accentDim : 'transparent',
              })}
            >
              <Text style={{ color: colors.accent, fontSize: noteTokens.chipFontSize, fontWeight: '900' }}>＋ {chip}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <SaveStatusLine status={status} error={error} onRetry={() => void retry()} />
        {multiline ? <Text style={{ color: colors.textMuted, fontSize: noteTokens.statusFontSize }}>{text.length}/{maxLength}</Text> : null}
      </View>
    </View>
  );
}
