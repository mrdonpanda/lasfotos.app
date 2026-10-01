export const ANGLES = [
  { id: 'top', label: 'Top', short: 'Top' },
  { id: 'front', label: 'Front', short: 'Front' },
  { id: 'driver_side', label: 'Driver side', short: 'Driver' },
  { id: 'back', label: 'Back', short: 'Back' },
  { id: 'passenger_side', label: 'Passenger side', short: 'Pass.' },
  { id: 'keys', label: 'Keys', short: 'Keys' },
  { id: 'under_vehicle', label: 'Under vehicle', short: 'Under' },
] as const;

export type Angle = (typeof ANGLES)[number]['id'];

/** Short tag used in storage and album file names. */
export const ANGLE_FILE_TAG: Record<Angle, string> = {
  top: 'top',
  front: 'front',
  driver_side: 'driver',
  back: 'back',
  passenger_side: 'passenger',
  keys: 'keys',
  under_vehicle: 'under',
};

export const MAX_CARS = 30;
export const DEFAULT_CAR_COUNT = 9;

export function angleLabel(angle: Angle): string {
  return ANGLES.find((item) => item.id === angle)?.label ?? angle;
}

export function photoKey(carId: string, angle: Angle): string {
  return `${carId}:${angle}`;
}

/** First angle after `after` (wrapping) that is not in `done`; null when all seven are done. */
export function nextMissingAngle(done: ReadonlySet<Angle>, after?: Angle): Angle | null {
  const start = after ? ANGLES.findIndex((item) => item.id === after) + 1 : 0;
  for (let i = 0; i < ANGLES.length; i += 1) {
    const candidate = ANGLES[(start + i) % ANGLES.length].id;
    if (!done.has(candidate)) return candidate;
  }
  return null;
}
