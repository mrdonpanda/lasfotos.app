/**
 * lasfotos.app design tokens
 * Sunlight-first: black background, white text, yellow accent.
 * Status colors (green/red) must always be paired with an icon or label.
 */

import type { TextStyle } from 'react-native';

export const colors = {
  bg: '#000000',
  surface: '#111111',       // cards
  surfaceRaised: '#1C1C1C', // modals, pressed cards
  overlay: 'rgba(0,0,0,0.65)', // camera header

  text: '#FFFFFF',
  textMuted: '#D0D0D0',     // never darker than this on black (contrast)
  textOnAccent: '#000000',

  accent: '#FFD400',        // primary actions, captured state, focus
  accentPressed: '#E6BF00',
  accentDim: 'rgba(255,212,0,0.18)',

  border: '#FFFFFF',
  borderMuted: '#666666',

  success: '#3DDC84',
  danger: '#FF4D4D',
  warning: '#FFD400',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const borderWidth = {
  thin: 2,
  thick: 3,
} as const;

export const fontSize = {
  body: 18,
  label: 16,
  button: 22,
  title: 28,
  heading: 34,
  lot: 44, // lot numbers: biggest thing on screen
  note: 14, // compact one-line previews of notes (still readable in sunlight)
  tileLabel: 12,
} as const;

export const fontWeight = {
  regular: '500',
  bold: '700',
  black: '900',
} as const;

export const typography = {
  body: { fontSize: fontSize.body, fontWeight: fontWeight.regular, color: colors.text },
  label: { fontSize: fontSize.label, fontWeight: fontWeight.bold, color: colors.textMuted },
  button: { fontSize: fontSize.button, fontWeight: fontWeight.black, letterSpacing: 0.5 },
  title: { fontSize: fontSize.title, fontWeight: fontWeight.bold, color: colors.text },
  heading: { fontSize: fontSize.heading, fontWeight: fontWeight.black, color: colors.text },
  lot: {
    fontSize: fontSize.lot,
    fontWeight: fontWeight.black,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TextStyle>;

/** Gloves + moving fast: nothing tappable smaller than this. */
export const touch = {
  min: 64,
  button: 72,
  shutter: 88,
  angleTile: 66, // 25% smaller than the original 88: 4 per row, 2 rows instead of 3 (still above the 64 glove minimum)
  hitSlop: { top: 12, bottom: 12, left: 12, right: 12 },
} as const;

export const angles = [
  { key: 'top', label: 'TOP' },
  { key: 'front', label: 'FRONT' },
  { key: 'driver_side', label: 'DRIVER SIDE' },
  { key: 'back', label: 'BACK' },
  { key: 'passenger_side', label: 'PASSENGER SIDE' },
  { key: 'keys', label: 'KEYS' },
  { key: 'under_vehicle', label: 'UNDER VEHICLE' },
] as const;

export type AngleKey = (typeof angles)[number]['key'];

/** Angle tile states; each has a fill/border plus an icon or label (never color alone). */
export const angleState = {
  empty:     { bg: 'transparent',    border: colors.border,  fg: colors.text,          icon: 'camera-outline' },
  captured:  { bg: colors.accent,    border: colors.accent,  fg: colors.textOnAccent,  icon: 'checkmark' },
  uploading: { bg: colors.accentDim, border: colors.accent,  fg: colors.accent,        icon: 'cloud-upload-outline' },
  failed:    { bg: 'transparent',    border: colors.danger,  fg: colors.danger,        icon: 'refresh' },
} as const;

/** Reusable component style presets. */
export const components = {
  primaryButton: {
    minHeight: touch.button,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.lg,
  },
  secondaryButton: {
    minHeight: touch.button,
    borderWidth: borderWidth.thick,
    borderColor: colors.border,
    borderRadius: radius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: spacing.lg,
  },
  input: {
    minHeight: touch.min,
    borderWidth: borderWidth.thick,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.title,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: borderWidth.thin,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  lotPlaceholder: {
    minHeight: touch.min,
    borderWidth: borderWidth.thick,
    borderColor: colors.accent,
    borderStyle: 'dashed' as const,
    borderRadius: radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
} as const;

/** Angle tile internals (state is shown by icon + border + fill, never color alone). */
export const angleTile = {
  size: touch.angleTile,
  iconSize: 21,
  labelSize: fontSize.tileLabel,
  gap: spacing.sm,
} as const;

/** Notes (trip + lot): inputs, status line and quick-note chips. */
export const notes = {
  tripInputMinHeight: 96,
  inputFontSize: fontSize.body,
  previewFontSize: fontSize.note,
  chipMinHeight: touch.min,
  chipFontSize: fontSize.label,
  statusFontSize: fontSize.note,
  iconSize: 28,
} as const;

export const camera = {
  headerBg: colors.overlay,
  headerText: { ...typography.title, fontWeight: fontWeight.black },
  shutterSize: touch.shutter,
  thumbSize: 56,
} as const;

export const theme = {
  colors, spacing, radius, borderWidth, fontSize, fontWeight,
  typography, touch, angles, angleState, angleTile, notes, components, camera,
} as const;

export default theme;
