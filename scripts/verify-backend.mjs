/**
 * Live check of the schema, RLS and private storage bucket against the Supabase project in .env.
 * Creates two throwaway users (admin API), exercises the same calls the app makes, then deletes them.
 *   node scripts/verify-backend.mjs
 * Uses SUPABASE_SECRET_KEY only to create/delete the test users; the app never sees it.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^['"]|['"]$/g, '')]),
);
const url = env.SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const newClient = () => createClient(url, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
  if (!ok) failures += 1;
};

const password = `Tmp-${randomUUID()}`;
const users = [];
async function makeUser(label) {
  const email = `verify-${label}-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = newClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  users.push(data.user.id);
  return { id: data.user.id, client };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

try {
  const a = await makeUser('a');
  const b = await makeUser('b');

  // trip + cars (what createTrip does)
  const { data: trip, error: tripErr } = await a.client
    .from('trips').insert({ location_name: 'Verify yard', trip_date: '2026-09-29' }).select('id, user_id').single();
  check('user A creates a trip (user_id defaults to auth.uid())', !tripErr && trip.user_id === a.id, tripErr?.message);

  const { error: carsErr } = await a.client.from('cars').insert(
    [1, 2, 3].map((p) => ({ trip_id: trip.id, user_id: a.id, position: p, lot_number: null })));
  check('batch insert of blank cars', !carsErr, carsErr?.message);
  const { data: cars } = await a.client.from('cars').select('id, lot_number, position').eq('trip_id', trip.id).order('position');
  check('cars start with null lot_number', cars?.length === 3 && cars.every((c) => c.lot_number === null));

  // lot number rules
  const bad = await a.client.from('cars').update({ lot_number: 'bad lot!' }).eq('id', cars[0].id);
  check('lot number with unsafe characters is rejected', !!bad.error);
  const ok1 = await a.client.from('cars').update({ lot_number: '123456' }).eq('id', cars[0].id);
  check('valid lot number saved', !ok1.error, ok1.error?.message);
  const dup = await a.client.from('cars').update({ lot_number: '123456' }).eq('id', cars[1].id);
  check('duplicate lot number in one trip is rejected (23505)', dup.error?.code === '23505', JSON.stringify(dup.error));

  // upload to the private bucket
  const path = `${a.id}/${trip.id}/123456_front.jpg`;
  const up = await a.client.storage.from('fotos').upload(path, JPEG, { contentType: 'image/jpeg', upsert: true });
  check('user A uploads to fotos under own user/trip folder', !up.error, up.error?.message);
  const up2 = await a.client.storage.from('fotos').upload(path, JPEG, { contentType: 'image/jpeg', upsert: true });
  check('upsert (retake) replaces the object', !up2.error, up2.error?.message);
  const png = await a.client.storage.from('fotos').upload(`${a.id}/${trip.id}/x.png`, JPEG, { contentType: 'image/png' });
  check('non-JPEG upload is rejected by bucket rules', !!png.error);

  const row = await a.client.from('photos').upsert(
    { user_id: a.id, car_id: cars[0].id, angle: 'front', storage_path: path }, { onConflict: 'car_id,angle' });
  check('photos row upsert on (car_id, angle)', !row.error, row.error?.message);
  const row2 = await a.client.from('photos').upsert(
    { user_id: a.id, car_id: cars[0].id, angle: 'front', storage_path: path }, { onConflict: 'car_id,angle' });
  const { count } = await a.client.from('photos').select('id', { count: 'exact', head: true }).eq('car_id', cars[0].id);
  check('re-upsert keeps a single row', !row2.error && count === 1, `count=${count}`);
  const badAngle = await a.client.from('photos').insert({ user_id: a.id, car_id: cars[0].id, angle: 'roof', storage_path: 'x' });
  check('unknown angle is rejected', !!badAngle.error);

  // gallery: joined query + signed URL
  const joined = await a.client.from('photos').select('id, car_id, angle, storage_path, cars!inner(trip_id)').eq('cars.trip_id', trip.id);
  check('gallery join query returns the photo', !joined.error && joined.data.length === 1, joined.error?.message);
  const signed = await a.client.storage.from('fotos').createSignedUrls([path], 3600);
  const signedUrl = signed.data?.[0]?.signedUrl;
  check('createSignedUrls returns a URL', !!signedUrl, signed.error?.message);
  if (signedUrl) {
    const res = await fetch(signedUrl);
    const body = new Uint8Array(await res.arrayBuffer());
    check('signed URL serves the JPEG', res.ok && body.length === JPEG.length, `status ${res.status}`);
  }
  const pub = await fetch(`${url}/storage/v1/object/public/fotos/${path}`);
  check('bucket is private (public URL does not serve the file)', !pub.ok, `status ${pub.status}`);

  // lot rename = storage.move + row update
  const newPath = `${a.id}/${trip.id}/999_front.jpg`;
  const mv = await a.client.storage.from('fotos').move(path, newPath);
  check('storage.move renames the object', !mv.error, mv.error?.message);

  // isolation: user B sees and touches nothing of A's
  const bTrips = await b.client.from('trips').select('id');
  check('user B cannot read A\'s trips', !bTrips.error && bTrips.data.length === 0);
  const bCars = await b.client.from('cars').select('id');
  check('user B cannot read A\'s cars', !bCars.error && bCars.data.length === 0);
  const bPhotos = await b.client.from('photos').select('id');
  check('user B cannot read A\'s photos', !bPhotos.error && bPhotos.data.length === 0);
  const bSign = await b.client.storage.from('fotos').createSignedUrls([newPath], 60);
  check('user B cannot sign A\'s files', !bSign.data?.[0]?.signedUrl, JSON.stringify(bSign.data));
  const bList = await b.client.storage.from('fotos').list(`${a.id}/${trip.id}`);
  check('user B cannot list A\'s folder', !bList.error && bList.data.length === 0);
  const bUpload = await b.client.storage.from('fotos').upload(`${a.id}/${trip.id}/evil.jpg`, JPEG, { contentType: 'image/jpeg' });
  check('user B cannot upload into A\'s folder', !!bUpload.error);
  const bCar = await b.client.from('cars').insert({ trip_id: trip.id, user_id: b.id, position: 9 });
  check('user B cannot attach a car to A\'s trip', !!bCar.error);
  const bPhoto = await b.client.from('photos').insert({ user_id: b.id, car_id: cars[0].id, angle: 'top', storage_path: 'x' });
  check('user B cannot attach a photo to A\'s car', !!bPhoto.error);
  const bDel = await b.client.from('trips').delete().eq('id', trip.id);
  const still = await a.client.from('trips').select('id').eq('id', trip.id);
  check('user B cannot delete A\'s trip', !bDel.error && still.data.length === 1);
  // notes (migration 20260929230000_notes.sql)
  const tNote = await a.client.from('trips').update({ notes: 'Gate code 4411\nCall Sam' }).eq('id', trip.id);
  const tRead = await a.client.from('trips').select('notes').eq('id', trip.id).single();
  check('trip notes save and read back (multi-line)', !tNote.error && tRead.data?.notes === 'Gate code 4411\nCall Sam', tNote.error?.message);
  const cNote = await a.client.from('cars').update({ notes: 'No keys; No catalytic' }).eq('id', cars[0].id);
  const cRead = await a.client.from('cars').select('notes').eq('id', cars[0].id).single();
  check('lot notes save and read back', !cNote.error && cRead.data?.notes === 'No keys; No catalytic', cNote.error?.message);
  const clear = await a.client.from('cars').update({ notes: null }).eq('id', cars[0].id);
  check('a note can be cleared (NULL)', !clear.error);
  const longCar = await a.client.from('cars').update({ notes: 'x'.repeat(201) }).eq('id', cars[0].id);
  check('lot note over 200 chars is rejected', !!longCar.error, longCar.error?.code);
  const longTrip = await a.client.from('trips').update({ notes: 'x'.repeat(2001) }).eq('id', trip.id);
  check('trip note over 2000 chars is rejected', !!longTrip.error, longTrip.error?.code);
  const maxCar = await a.client.from('cars').update({ notes: 'x'.repeat(200) }).eq('id', cars[0].id);
  check('lot note of exactly 200 chars is accepted', !maxCar.error);
  await b.client.from('cars').update({ notes: 'hacked' }).eq('id', cars[1].id);
  await b.client.from('trips').update({ notes: 'hacked' }).eq('id', trip.id);
  const intact = await a.client.from('trips').select('notes').eq('id', trip.id).single();
  const intactCar = await a.client.from('cars').select('notes').eq('id', cars[1].id).single();
  check("user B cannot change A's notes", intact.data?.notes === 'Gate code 4411\nCall Sam' && intactCar.data?.notes === null);
  const anon = await newClient().from('trips').select('id');
  check('anon role has no access to trips', !!anon.error || anon.data.length === 0, JSON.stringify(anon.data));

  // delete flow: remove objects then the trip, rows cascade
  const list = await a.client.storage.from('fotos').list(`${a.id}/${trip.id}`, { limit: 1000 });
  const rm = await a.client.storage.from('fotos').remove(list.data.map((f) => `${a.id}/${trip.id}/${f.name}`));
  check('trip folder objects removed', !rm.error && rm.data.length === 1, rm.error?.message);
  const del = await a.client.from('trips').delete().eq('id', trip.id);
  const left = await admin.from('photos').select('id', { count: 'exact', head: true }).eq('car_id', cars[0].id);
  const leftCars = await admin.from('cars').select('id', { count: 'exact', head: true }).eq('trip_id', trip.id);
  check('deleting the trip cascades to cars and photos', !del.error && left.count === 0 && leftCars.count === 0);
} catch (err) {
  failures += 1;
  console.log('ERROR', err);
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
