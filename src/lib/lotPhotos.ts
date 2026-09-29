import { ANGLE_FILE_TAG, type Angle } from './angles';

export const PHOTOS_BUCKET = 'fotos';

/** Signed URLs for the private bucket last this long (seconds). */
export const SIGNED_URL_TTL = 60 * 60;

export class WaitingForLotNumber extends Error {
  constructor() {
    super('Enter the lot number before this photo can send');
    this.name = 'WaitingForLotNumber';
  }
}

const LOT_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function sanitizeLotNumber(lotNumber: string): string {
  return lotNumber.trim().replace(/[^\w.-]+/g, '');
}

/** True when the trimmed value is already safe to use in a file name. */
export function isValidLotNumber(lotNumber: string): boolean {
  return LOT_PATTERN.test(lotNumber.trim());
}

function segment(value: string, what: string): string {
  const clean = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) throw new Error(`${what} is missing`);
  return clean;
}

export function tripPrefix(userId: string, tripId: string): string {
  return `${segment(userId, 'The signed-in user')}/${segment(tripId, 'The trip')}`;
}

/**
 * Every storage path is built here:
 *   {user_id}/{trip_id}/{lot_number}_{angle_tag}.jpg
 * Lot numbers are unique per trip (database index), so paths cannot collide.
 */
export function photoObjectPath(userId: string, tripId: string, lotNumber: string, angle: Angle): string {
  const prefix = tripPrefix(userId, tripId);
  const lot = sanitizeLotNumber(lotNumber);
  if (!lot) throw new WaitingForLotNumber();
  return `${prefix}/${lot}_${ANGLE_FILE_TAG[angle]}.jpg`;
}

/** File name used for the local Files/album copy. */
export function localCopyName(lotNumber: string, angle: Angle): string {
  const lot = sanitizeLotNumber(lotNumber) || 'nolot';
  return `${lot}_${ANGLE_FILE_TAG[angle]}.jpg`;
}
