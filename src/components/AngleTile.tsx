import { Camera, Check, CloudUpload, RefreshCw } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

import { angleState, angleTile, radius, spacing } from '../../theme';

export type TileState = 'empty' | 'captured' | 'uploading' | 'failed';

const ICONS = {
  empty: Camera,
  captured: Check,
  uploading: CloudUpload,
  failed: RefreshCw,
} as const;

/** Spoken state (screen readers). The tile itself shows state with icon + border + fill. */
const SPOKEN: Record<TileState, string> = {
  empty: 'not taken',
  captured: 'saved',
  uploading: 'sending',
  failed: 'failed, tap to retry',
};

export function AngleTile({
  label,
  shortLabel,
  state,
  onPress,
}: {
  /** Full name, spoken by screen readers. */
  label: string;
  /** Fits the 66px tile at 12px ("Pass." for Passenger side). */
  shortLabel: string;
  state: TileState;
  onPress: () => void;
}) {
  const look = angleState[state];
  const Icon = ICONS[state];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${SPOKEN[state]}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: angleTile.size,
        height: angleTile.size,
        borderRadius: radius.md,
        borderWidth: 3,
        borderColor: look.border,
        backgroundColor: look.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.xs,
        overflow: 'hidden',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon color={look.fg} size={angleTile.iconSize} />
      <Text
        style={{ color: look.fg, fontSize: angleTile.labelSize, fontWeight: '900', textAlign: 'center' }}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {shortLabel.toUpperCase()}
      </Text>
    </Pressable>
  );
}
