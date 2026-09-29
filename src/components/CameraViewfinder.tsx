import { CameraView, type CameraViewProps } from 'expo-camera';
import { useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { BackHandler, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { camera as cameraTokens, colors, spacing, typography } from '../../theme';
import { ANGLES, type Angle } from '../lib/angles';
import { ensureCameraAccess } from '../lib/cameraAccess';
import { selectWidestBackCamera, type WidestCameraChoice } from '../lib/cameraDevices';
import { queryCameraDevices } from '../lib/cameraQuery';
import { ensureDeviceAlbumPermission } from '../lib/deviceAlbum';
import { getLocalCopyEnabled } from '../lib/settings';
import { startVolumeShutter } from '../lib/volumeShutter';
import { BigButton } from './ui';

type WidestProps = CameraViewProps & { cameraId?: string; useWidestZoom?: boolean };
const WidestCamera = CameraView as ComponentType<WidestProps & { ref?: Ref<CameraView> }>;

function lensNames(lenses: unknown): string[] {
  if (!Array.isArray(lenses)) return [];
  return lenses
    .map((lens) => {
      if (typeof lens === 'string') return lens;
      if (lens && typeof lens === 'object') {
        const record = lens as { localizedName?: string; deviceType?: string };
        return record.localizedName || record.deviceType || '';
      }
      return '';
    })
    .filter(Boolean);
}

export type Shot = { uri: string; width: number; height: number };

/**
 * Full-screen viewfinder: widest back lens, Volume Up/Down as the shutter,
 * and a semi-transparent black header reading "LOT 123456 | FRONT".
 * It stays mounted between shots so the driver can run through all seven angles.
 */
export function CameraViewfinder({
  lotNumber,
  angle,
  doneAngles,
  onSelectAngle,
  onShot,
  onClose,
}: {
  lotNumber: string;
  angle: Angle;
  doneAngles: ReadonlySet<Angle>;
  onSelectAngle: (angle: Angle) => void;
  onShot: (photo: Shot) => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const frame = { flex: 1 as const, width, height, backgroundColor: colors.bg };
  const cameraRef = useRef<CameraView>(null);
  const shooting = useRef(false);
  const [access, setAccess] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [albumReady, setAlbumReady] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<WidestCameraChoice | null>(null);
  const [forceDefault, setForceDefault] = useState(false);
  const [lensOverride, setLensOverride] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shootRef = useRef<() => void>(() => undefined);
  const angleLabel = ANGLES.find((item) => item.id === angle)?.label ?? angle;

  useEffect(() => {
    let live = true;
    ensureCameraAccess()
      .then((ok) => live && setAccess(ok ? 'granted' : 'denied'))
      .catch(() => live && setAccess('denied'));
    return () => {
      live = false;
    };
  }, []);

  // Ask for the Files-album permission up front, but only when the local copy is switched on.
  useEffect(() => {
    if (access !== 'granted') return;
    let live = true;
    getLocalCopyEnabled()
      .then((enabled) => (enabled ? ensureDeviceAlbumPermission() : true))
      .then((ok) => live && setAlbumReady(ok))
      .catch(() => live && setAlbumReady(false));
    return () => {
      live = false;
    };
  }, [access]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  useEffect(() => {
    if (access !== 'granted') return;
    let live = true;
    queryCameraDevices()
      .then((devices) => live && setChoice(selectWidestBackCamera(devices)))
      .catch(() => live && setChoice(selectWidestBackCamera([])));
    return () => {
      live = false;
    };
  }, [access]);

  async function askAgain() {
    setAccess('pending');
    setError(null);
    try {
      setAccess((await ensureCameraAccess()) ? 'granted' : 'denied');
    } catch {
      setAccess('denied');
    }
  }

  async function shoot() {
    if (shooting.current || !cameraRef.current) return;
    shooting.current = true;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) throw new Error('The camera did not return a photo');
      onShot({ uri: photo.uri, width: photo.width, height: photo.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the photo');
    } finally {
      shooting.current = false;
      setBusy(false);
    }
  }
  shootRef.current = () => void shoot();

  const showCamera = access === 'granted' && choice != null;
  const selectedLens = lensOverride ?? choice?.selectedLens;

  // Volume Up / Down = shutter while the viewfinder is on screen; the volume UI is restored on unmount.
  useEffect(() => {
    if (!showCamera) return;
    let live = true;
    let shutter: { stop: () => void } | null = null;
    startVolumeShutter(() => shootRef.current())
      .then((started) => {
        if (!live) started.stop();
        else shutter = started;
      })
      .catch(() => undefined);
    return () => {
      live = false;
      shutter?.stop();
    };
  }, [showCamera]);

  return (
    <View testID="camera-frame" collapsable={false} style={frame}>
      {showCamera ? (
        <WidestCamera
          key={forceDefault ? 'default-back' : 'widest-back'}
          ref={cameraRef}
          testID="camera-view"
          collapsable={false}
          style={frame}
          facing="back"
          mode="picture"
          zoom={choice.zoom}
          selectedLens={selectedLens}
          cameraId={forceDefault ? undefined : choice.deviceId}
          useWidestZoom={choice.useWidestZoom}
          onMountError={(event) => {
            if (!forceDefault && choice.deviceId) {
              setForceDefault(true);
              setError(null);
              return;
            }
            setError(event.message || 'The camera preview did not start');
          }}
          onAvailableLensesChanged={(event) => {
            const ultra = lensNames(event.lenses).find((lens) => /ultra/i.test(lens));
            if (ultra) setLensOverride(ultra);
          }}
        />
      ) : (
        <View style={[frame, { justifyContent: 'center', padding: spacing.lg, gap: spacing.md }]}>
          {access === 'denied' ? (
            <>
              <Text style={[typography.heading, { textAlign: 'center' }]}>Camera access is needed to shoot the cars.</Text>
              <BigButton label="Allow camera" onPress={() => void askAgain()} />
              <BigButton label="Cancel" tone="secondary" onPress={onClose} />
            </>
          ) : (
            <Text style={[typography.heading, { textAlign: 'center' }]}>Opening camera</Text>
          )}
        </View>
      )}

      {showCamera ? (
        <>
          <View style={header}>
            <Text style={cameraTokens.headerText} numberOfLines={1}>
              LOT: {lotNumber} | {angleLabel.toUpperCase()}
            </Text>
          </View>

          <View style={controls}>
            {albumReady === false ? (
              <>
                <Text style={warning}>⚠ Allow photo storage so each photo also stays in the LasFotos album.</Text>
                <BigButton
                  label="Allow photo storage"
                  onPress={() => void ensureDeviceAlbumPermission(true).then(setAlbumReady)}
                />
              </>
            ) : null}
            {error ? <Text style={warning}>⚠ {error}</Text> : null}

            <View style={strip}>
              {ANGLES.map((item, index) => {
                const current = item.id === angle;
                const done = doneAngles.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}${done ? ', taken' : ''}`}
                    onPress={() => onSelectAngle(item.id)}
                    style={{
                      width: cameraTokens.thumbSize - 8,
                      height: cameraTokens.thumbSize - 8,
                      borderRadius: 12,
                      borderWidth: 3,
                      borderColor: current ? colors.accent : colors.border,
                      backgroundColor: current ? colors.accent : done ? colors.accentDim : colors.overlay,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: current ? colors.textOnAccent : colors.text, fontWeight: '900', fontSize: 20 }}>
                      {done && !current ? '✓' : index + 1}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Take ${angleLabel} photo`}
              disabled={busy}
              onPress={() => void shoot()}
              style={({ pressed }) => [shutter, { opacity: busy ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <Text style={typography.button}>{busy ? 'SAVING…' : `TAKE ${angleLabel.toUpperCase()}`}</Text>
            </Pressable>
            <BigButton label="Done" tone="secondary" onPress={onClose} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const header = {
  position: 'absolute' as const,
  top: 36,
  left: spacing.md,
  right: spacing.md,
  backgroundColor: cameraTokens.headerBg,
  borderRadius: 12,
  padding: spacing.md,
};

const controls = {
  position: 'absolute' as const,
  left: spacing.md,
  right: spacing.md,
  bottom: 40,
  gap: spacing.sm,
};

const strip = {
  flexDirection: 'row' as const,
  justifyContent: 'space-between' as const,
};

const shutter = {
  minHeight: cameraTokens.shutterSize,
  borderRadius: 16,
  backgroundColor: colors.accent,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  paddingHorizontal: spacing.md,
};

const warning = {
  color: colors.danger,
  fontSize: 20,
  fontWeight: '800' as const,
  textAlign: 'center' as const,
  backgroundColor: colors.overlay,
  borderRadius: 8,
  padding: spacing.sm,
};
