import { Camera, Check, CloudUpload, RefreshCw } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

import { angleState, colors, radius, spacing, touch } from '../../theme';

export type TileState = 'empty' | 'captured' | 'uploading' | 'failed';

const ICONS = {
  empty: Camera,
  captured: Check,
  uploading: CloudUpload,
  failed: RefreshCw,
} as const;

const CAPTIONS: Record<TileState, string> = {
  empty: '',
  captured: 'Saved',
  uploading: 'Sending',
  failed: 'Retrying',
};

export function AngleTile({
  label,
  state,
  onPress,
}: {
  label: string;
  state: TileState;
  onPress: () => void;
}) {
  const look = angleState[state];
  const Icon = ICONS[state];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${state === 'empty' ? 'not taken' : CAPTIONS[state]}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touch.angleTile,
        minHeight: touch.angleTile,
        borderRadius: radius.md,
        borderWidth: 3,
        borderColor: look.border,
        backgroundColor: look.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.xs,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon color={look.fg} size={28} />
      <Text style={{ color: look.fg, fontSize: 13, fontWeight: '900', textAlign: 'center' }} numberOfLines={2}>
        {label.toUpperCase()}
      </Text>
      {CAPTIONS[state] ? (
        <Text style={{ color: state === 'captured' ? colors.textOnAccent : look.fg, fontSize: 11, fontWeight: '700' }}>
          {CAPTIONS[state]}
        </Text>
      ) : null}
    </Pressable>
  );
}
