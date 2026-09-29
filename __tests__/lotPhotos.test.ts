import { ANGLES, nextMissingAngle, type Angle } from '../src/lib/angles';
import {
  isValidLotNumber,
  localCopyName,
  photoObjectPath,
  sanitizeLotNumber,
  tripPrefix,
  WaitingForLotNumber,
} from '../src/lib/lotPhotos';
import { angles as themeAngles } from '../theme';

const USER = 'feafb4a1-3c94-44b6-897b-0dfc2b19dd40';
const TRIP = '9c1d2e3f-0000-4000-8000-123456789abc';

describe('photo object paths', () => {
  it('puts the lot number in the file name under user and trip', () => {
    expect(photoObjectPath(USER, TRIP, '123456', 'driver_side')).toBe(`${USER}/${TRIP}/123456_driver.jpg`);
  });

  it('uses the short tag for every angle', () => {
    const tags = ANGLES.map((a) => photoObjectPath(USER, TRIP, '7', a.id).split('_').pop());
    expect(tags).toEqual(['top.jpg', 'front.jpg', 'driver.jpg', 'back.jpg', 'passenger.jpg', 'keys.jpg', 'under.jpg']);
  });

  it('waits when the lot number is blank', () => {
    expect(() => photoObjectPath(USER, TRIP, '  ', 'top')).toThrow(WaitingForLotNumber);
  });

  it('strips characters that are unsafe in file names', () => {
    expect(sanitizeLotNumber(' 12 3/4? ')).toBe('1234');
    expect(photoObjectPath(USER, TRIP, '../x', 'top')).toBe(`${USER}/${TRIP}/..x_top.jpg`);
  });

  it('rejects a missing user or trip', () => {
    expect(() => tripPrefix('', TRIP)).toThrow();
    expect(() => tripPrefix(USER, 'a/b')).toThrow();
  });

  it('validates lot numbers like the database check', () => {
    expect(isValidLotNumber('123-45_a.b')).toBe(true);
    expect(isValidLotNumber('12 34')).toBe(false);
    expect(isValidLotNumber('')).toBe(false);
  });

  it('names the local copy with lot and angle', () => {
    expect(localCopyName('123456', 'front')).toBe('123456_front.jpg');
    expect(localCopyName('', 'keys')).toBe('nolot_keys.jpg');
  });
});

describe('angles', () => {
  it('finds the next missing angle in order, wrapping around', () => {
    const done = new Set<Angle>(['top', 'front']);
    expect(nextMissingAngle(done)).toBe('driver_side');
    expect(nextMissingAngle(done, 'front')).toBe('driver_side');
    expect(nextMissingAngle(new Set<Angle>(['back', 'passenger_side', 'keys', 'under_vehicle']), 'under_vehicle')).toBe(
      'top',
    );
    expect(nextMissingAngle(new Set(ANGLES.map((a) => a.id)))).toBeNull();
  });

  it('keeps the theme angle list in sync with the database angles', () => {
    expect(themeAngles.map((a) => a.key)).toEqual(ANGLES.map((a) => a.id));
  });
});
