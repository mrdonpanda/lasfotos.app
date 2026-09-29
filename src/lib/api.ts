import { type Angle } from './angles';
import { isValidLotNumber, PHOTOS_BUCKET, photoObjectPath, tripPrefix, WaitingForLotNumber } from './lotPhotos';
import { requireOnline } from './network';
import { supabase } from './supabase';

export type Trip = {
  id: string;
  location_name: string;
  trip_date: string;
  created_at: string;
};

export type TripSummary = Trip & { carCount: number; lotCount: number; photoCount: number };

export type Car = {
  id: string;
  trip_id: string;
  user_id: string;
  position: number;
  lot_number: string | null;
};

export type PhotoRow = {
  id: string;
  car_id: string;
  angle: Angle;
  storage_path: string;
};

function fail(error: { message: string; code?: string } | null, fallback: string): asserts error is null {
  if (error) throw new Error(error.message || fallback);
}

// ---------------------------------------------------------------- trips

export async function listTrips(): Promise<TripSummary[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('id, location_name, trip_date, created_at, cars(id, lot_number, photos(id))')
    .order('trip_date', { ascending: false })
    .order('created_at', { ascending: false });
  fail(error, 'Could not load trips');
  type Row = Trip & { cars: Array<{ id: string; lot_number: string | null; photos: Array<{ id: string }> }> };
  return ((data ?? []) as unknown as Row[]).map(({ cars, ...trip }) => ({
    ...trip,
    carCount: cars.length,
    lotCount: cars.filter((car) => car.lot_number).length,
    photoCount: cars.reduce((sum, car) => sum + car.photos.length, 0),
  }));
}

export async function getTrip(tripId: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .select('id, location_name, trip_date, created_at')
    .eq('id', tripId)
    .maybeSingle();
  fail(error, 'Could not load the trip');
  if (!data) throw new Error('This trip no longer exists');
  return data as Trip;
}

export async function createTrip(input: { location: string; date: string; carCount: number }): Promise<string> {
  await requireOnline();
  const { data: trip, error } = await supabase
    .from('trips')
    .insert({ location_name: input.location.trim(), trip_date: input.date })
    .select('id, user_id')
    .single();
  fail(error, 'Could not create the trip');
  const rows = Array.from({ length: input.carCount }, (_, index) => ({
    trip_id: trip.id as string,
    user_id: trip.user_id as string,
    position: index + 1,
    lot_number: null,
  }));
  const { error: carsError } = await supabase.from('cars').insert(rows);
  if (carsError) {
    await supabase.from('trips').delete().eq('id', trip.id);
    throw new Error(carsError.message);
  }
  return trip.id as string;
}

export async function updateTrip(tripId: string, input: { location: string; date: string }): Promise<void> {
  await requireOnline();
  const { error } = await supabase
    .from('trips')
    .update({ location_name: input.location.trim(), trip_date: input.date })
    .eq('id', tripId);
  fail(error, 'Could not save the trip');
}

/** Removes every stored object for the trip, then the trip (rows cascade). */
export async function deleteTrip(userId: string, tripId: string): Promise<void> {
  await requireOnline();
  await removeTripObjects(userId, tripId);
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  fail(error, 'Could not delete the trip');
}

async function removeTripObjects(userId: string, tripId: string): Promise<void> {
  const prefix = tripPrefix(userId, tripId);
  const { data, error } = await supabase.storage.from(PHOTOS_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(error.message);
  const paths = (data ?? []).filter((item) => item.name).map((item) => `${prefix}/${item.name}`);
  await removeObjects(paths);
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------- cars

export async function listCars(tripId: string): Promise<Car[]> {
  const { data, error } = await supabase
    .from('cars')
    .select('id, trip_id, user_id, position, lot_number')
    .eq('trip_id', tripId)
    .order('position');
  fail(error, 'Could not load cars');
  return (data ?? []) as Car[];
}

export async function listTripPhotos(tripId: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, car_id, angle, storage_path, cars!inner(trip_id)')
    .eq('cars.trip_id', tripId);
  fail(error, 'Could not load photos');
  return ((data ?? []) as unknown as Array<PhotoRow & { cars: unknown }>).map(
    ({ id, car_id, angle, storage_path }) => ({ id, car_id, angle, storage_path }),
  );
}

export async function listCarPhotos(carId: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('id, car_id, angle, storage_path')
    .eq('car_id', carId);
  fail(error, 'Could not load photos');
  return (data ?? []) as PhotoRow[];
}

export async function addCars(trip: { id: string; userId: string }, fromPosition: number, count: number): Promise<void> {
  await requireOnline();
  const rows = Array.from({ length: count }, (_, index) => ({
    trip_id: trip.id,
    user_id: trip.userId,
    position: fromPosition + index,
    lot_number: null,
  }));
  const { error } = await supabase.from('cars').insert(rows);
  fail(error, 'Could not add cars');
}

/** Deletes the cars' stored photos, then the cars (photo rows cascade). */
export async function removeCars(carIds: string[]): Promise<void> {
  if (!carIds.length) return;
  await requireOnline();
  const { data, error } = await supabase.from('photos').select('storage_path').in('car_id', carIds);
  fail(error, 'Could not remove the cars');
  await removeObjects((data ?? []).map((row) => String(row.storage_path)));
  const { error: deleteError } = await supabase.from('cars').delete().in('id', carIds);
  fail(deleteError, 'Could not remove the cars');
}

/**
 * Saves a lot number. When the car already has photos their storage objects
 * are renamed (the lot number is part of the file name). Any failure rolls
 * the lot number back so files and rows never disagree.
 */
export async function setLotNumber(car: Car, userId: string, rawLot: string): Promise<void> {
  const lot = rawLot.trim();
  if (!lot) throw new Error('Enter a lot number');
  if (!isValidLotNumber(lot)) throw new Error('Lot numbers can only use letters, numbers, _ . and -');
  if (lot === car.lot_number) return;
  await requireOnline();

  const photos = car.lot_number ? await listCarPhotos(car.id) : [];
  const { error } = await supabase.from('cars').update({ lot_number: lot }).eq('id', car.id);
  if (error) {
    if (error.code === '23505') throw new Error('That lot number is already used in this trip');
    throw new Error(error.message);
  }

  const moved: Array<{ id: string; from: string; to: string }> = [];
  try {
    for (const photo of photos) {
      const to = photoObjectPath(userId, car.trip_id, lot, photo.angle);
      if (to === photo.storage_path) continue;
      const { error: moveError } = await supabase.storage.from(PHOTOS_BUCKET).move(photo.storage_path, to);
      if (moveError) throw new Error(moveError.message);
      moved.push({ id: photo.id, from: photo.storage_path, to });
      const { error: rowError } = await supabase.from('photos').update({ storage_path: to }).eq('id', photo.id);
      if (rowError) throw new Error(rowError.message);
    }
  } catch (err) {
    for (const item of moved.reverse()) {
      await supabase.storage.from(PHOTOS_BUCKET).move(item.to, item.from);
      await supabase.from('photos').update({ storage_path: item.from }).eq('id', item.id);
    }
    await supabase.from('cars').update({ lot_number: car.lot_number }).eq('id', car.id);
    throw err instanceof Error ? err : new Error('Could not rename the photos');
  }
}

export { WaitingForLotNumber };
