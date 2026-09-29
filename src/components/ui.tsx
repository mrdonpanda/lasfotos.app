import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, components, spacing, touch, typography } from '../../theme';
import { useUploadJobs } from '../lib/queueContext';

export function Screen({
  children,
  footer,
  scroll = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, padding: spacing.md, gap: spacing.md }}>{children}</View>
        )}
        {footer ? <View style={{ padding: spacing.md, paddingTop: 0, gap: spacing.sm }}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={typography.heading}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[typography.body, muted ? { color: colors.textMuted } : null]}>{children}</Text>;
}

/** Prefixed with a warning sign so red is never the only signal. */
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={[typography.body, { color: colors.danger, fontWeight: '700' }]}>⚠ {children}</Text>;
}

export function BigButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const base = tone === 'primary' ? components.primaryButton : components.secondaryButton;
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        { flexDirection: 'row', gap: spacing.sm },
        danger ? { borderColor: colors.danger } : null,
        {
          opacity: disabled ? 0.45 : 1,
          backgroundColor:
            tone === 'primary' ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.surfaceRaised : 'transparent',
        },
      ]}
    >
      {icon}
      <Text
        style={[
          typography.button,
          { color: tone === 'primary' ? colors.textOnAccent : danger ? colors.danger : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BigField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  autoFocus = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoFocus?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={typography.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.borderMuted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        maxLength={maxLength}
        autoCorrect={false}
        style={components.input}
      />
    </View>
  );
}

export function BackButton({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.back()}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        minHeight: touch.min,
      })}
    >
      <ChevronLeft color={colors.text} size={40} />
      <Text style={typography.body}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}
    >
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={typography.title}>{label}</Text>
    </SafeAreaView>
  );
}

/** Persistent banner: shown whenever the offline queue has items. */
export function PendingBanner() {
  const jobs = useUploadJobs();
  if (!jobs.length) return null;
  const failing = jobs.filter((job) => job.status === 'failed').length;
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: colors.accent,
        borderRadius: 12,
        padding: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
    >
      <ActivityIndicator color={colors.textOnAccent} />
      <Text style={[typography.button, { color: colors.textOnAccent, flex: 1 }]}>
        {jobs.length} Pending Upload{jobs.length === 1 ? '' : 's'}
        {failing ? ` · ${failing} retrying` : ''}
      </Text>
    </View>
  );
}
