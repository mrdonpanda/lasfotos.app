export type CameraDevice = {
  id: string;
  position: string;
  lensType?: string;
  name?: string;
  deviceType?: string;
  minZoom?: number;
  maxZoom?: number;
  minFocalLength?: number;
  focalLengths?: number[];
};

export type WidestCameraChoice = {
  deviceId?: string;
  selectedLens?: string;
  zoom: number;
  useWidestZoom: boolean;
};

function describe(device: CameraDevice): string {
  return `${device.lensType ?? ''} ${device.name ?? ''} ${device.deviceType ?? ''} ${device.id}`.toLowerCase();
}

export function isUltrawide(device: CameraDevice): boolean {
  return describe(device).includes('ultra');
}

function shortestFocal(devices: CameraDevice[]): CameraDevice | undefined {
  const withFocal = devices.filter((device) => (device.minFocalLength ?? 0) > 0);
  if (!withFocal.length) return undefined;
  const minFocal = Math.min(...withFocal.map((device) => device.minFocalLength ?? Number.POSITIVE_INFINITY));
  const dedicated = withFocal.find(
    (device) =>
      withFocal.length > 1 &&
      device.focalLengths?.length === 1 &&
      Math.abs((device.minFocalLength ?? 0) - minFocal) < 0.05,
  );
  if (dedicated) return dedicated;
  return withFocal.reduce((best, device) =>
    (device.minFocalLength ?? Number.POSITIVE_INFINITY) < (best.minFocalLength ?? Number.POSITIVE_INFINITY)
      ? device
      : best,
  );
}

function widestZoom(devices: CameraDevice[]): CameraDevice | undefined {
  const zoomable = devices.filter((device) => {
    const minZoom = device.minZoom ?? 0;
    return minZoom > 0 && minZoom < 0.99;
  });
  if (!zoomable.length) return undefined;
  return zoomable.reduce((best, device) => ((device.minZoom ?? 1) < (best.minZoom ?? 1) ? device : best));
}

export function selectWidestBackCamera(devices: CameraDevice[]): WidestCameraChoice {
  const back = devices.filter((device) => device.position === 'back');
  const namedUltra = back.filter(isUltrawide);
  const dedicatedNamed = namedUltra.find((device) => device.focalLengths?.length === 1);
  const chosen = widestZoom(back) ?? dedicatedNamed ?? namedUltra[0] ?? shortestFocal(back) ?? back[0];
  const lensName = chosen && isUltrawide(chosen) && chosen.name && chosen.name !== chosen.id ? chosen.name : undefined;
  return {
    deviceId: chosen?.id,
    selectedLens: lensName,
    zoom: 0,
    useWidestZoom: true,
  };
}
