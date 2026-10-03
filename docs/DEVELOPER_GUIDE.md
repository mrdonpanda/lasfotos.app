# LasFotos Developer Guide

How the LasFotos app and its Supabase backend work under the hood. Read it top to bottom once, then use the
section headings as a map when you go back into the code.

Two things in this guide differ from the earlier drafts of the plan, so you don't get confused when you compare:

- **Storage path.** The final path is `{user_id}/{trip_id}/{lot_number}_{angle_tag}.jpg`, not `{car_id}_{angle}`.
  You decided the lot number must be visible in the file name, so the path uses it, and a database index makes
  sure two cars in one trip can never share a lot number (section 2.4).
- **Signed URLs.** The app calls `createSignedUrls` (plural, one round trip for many files), not `createSignedUrl`
  (section 5).

---

## 1. System architecture and tech stack

### 1.1 The pieces and how they connect

```
 +----------------------------- Android phone ------------------------------+
 |                                                                          |
 |  Expo Router (screens = files in app/)                                   |
 |        |                                                                 |
 |        v                                                                 |
 |  React Native components  --->  src/lib/*  (plain TypeScript logic)     |
 |        |                              |                                  |
 |        |                              +--> AsyncStorage (session + queue)|
 |        |                              +--> files on disk (queued JPEGs)  |
 |        v                                                                 |
 |  Native modules: expo-camera, react-native-volume-manager,               |
 |  expo-image-manipulator, expo-media-library, NetInfo, haptics            |
 +------------------------------|-------------------------------------------+
                                | HTTPS (supabase-js)
                                v
 +------------------------------ Supabase ----------------------------------+
 |  Auth (GoTrue)   Postgres + RLS (PostgREST)   Storage (private `fotos`)  |
 +--------------------------------------------------------------------------+
```

- **React Native** draws native Android views from React components. You write `<View>` and `<Text>`; there is
  no HTML or CSS.
- **Expo** is a toolkit around React Native. It gives you the build system (EAS), the config file
  (`app.config.js`), and ready-made native modules (camera, file system, media library).
- **Expo Router** turns the file tree under `app/` into screens. A file is a route; a folder is a URL segment;
  `_layout.tsx` wraps every screen beside and below it.
- **Supabase** is Postgres plus Auth plus Storage behind one HTTPS API. The app talks to it with a single
  `supabase` client object (`src/lib/supabase.ts`) built from your project URL and *publishable* key.
  That key is safe to ship in an app **only because** Row Level Security (section 2) decides what each signed-in
  user can touch. The secret (service) key is never used by the app.

### 1.2 How the Supabase URL and key reach the app

```
 Expo dashboard env vars (EAS builds)  or  .env (local)
        |
        v
 app.config.js  -> extra.supabaseUrl / extra.supabasePublishableKey
        |
        v
 src/lib/config.ts  reads Constants.expoConfig.extra
        |
        v
 src/lib/supabase.ts  createClient(url, key, { auth: { storage: AsyncStorage, autoRefreshToken: true, ... } })
```

`app.config.js` runs in Node **at build time**. It looks for `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` in the process environment first (this is where EAS injects your dashboard
variables), then falls back to reading `.env` (local dev). EAS cloud builds don't upload git-ignored files, which
is why a local `.env` alone does not work in a cloud build. The values are baked into the app's config, and the
app reads them at runtime through `expo-constants`.

The client is created with `storage: AsyncStorage`, so the login session survives app restarts, and
`autoRefreshToken: true`, so the access token is renewed in the background.

### 1.3 Folder structure

```
mobile-app/
├── app/                          # Expo Router: every file here is a screen or layout
│   ├── _layout.tsx               # ROOT layout: AuthProvider + StatusBar + Stack
│   ├── sign-in.tsx               # /sign-in  email+password sign-in / sign-up
│   └── (main)/                   # route GROUP: parentheses = not part of the URL
│       ├── _layout.tsx           # auth guard + upload-queue provider for everything below
│       ├── index.tsx             # /  home: trip list, pending banner, sign out
│       ├── camera.tsx            # /camera  route wrapper around the viewfinder
│       └── trip/
│           ├── new.tsx           # /trip/new  create a trip
│           └── [id]/             # [id] = dynamic segment (the trip's uuid)
│               ├── index.tsx     # /trip/<id>  the workspace (cars, lot numbers, angle tiles)
│               ├── edit.tsx      # /trip/<id>/edit  edit location/date/car count
│               └── gallery.tsx   # /trip/<id>/gallery  review photos (signed URLs)
├── src/
│   ├── components/
│   │   ├── CameraViewfinder.tsx  # the camera UI + hardware wiring (section 4)
│   │   ├── AngleTile.tsx         # one of the 7 angle buttons (empty/captured/uploading/failed)
│   │   ├── TripForm.tsx          # shared form for new + edit
│   │   └── ui.tsx                # Screen, BigButton, BigField, PendingBanner...
│   └── lib/                      # logic with no screens in it
│       ├── supabase.ts, config.ts, auth.tsx     # client + session context
│       ├── api.ts                # all table operations (trips, cars, photos)
│       ├── lotPhotos.ts          # storage path builder + lot-number rules
│       ├── photos.ts             # the actual upload + signed URLs
│       ├── uploadQueue.ts        # the offline queue engine (pure TypeScript, unit tested)
│       ├── appQueue.tsx          # wires the queue to real compress/upload/AsyncStorage/NetInfo
│       ├── queueContext.tsx      # React context + hooks: useUploadQueue, useUploadJobs
│       ├── compress.ts, resize.ts   # 1600px / quality 0.8 JPEG
│       ├── deviceAlbum.ts, settings.ts  # the "LasFotos" album copy and its on/off switch
│       ├── cameraDevices.ts, cameraQuery.ts, cameraAccess.ts  # lens choice + permission
│       ├── volumeShutter.ts      # volume-button shutter lifecycle
│       ├── network.ts, dates.ts, angles.ts, recentLocations.ts
├── scripts/
│   ├── patch-*.mjs               # postinstall patches for expo-camera + volume-manager (Android)
│   └── verify-backend.mjs        # live schema/RLS/storage self-test
├── supabase/migrations/          # the SQL that builds the database
├── theme.ts                      # design tokens: colors, sizes, typography
├── app.config.js, eas.json       # Expo config, EAS build profiles
└── __tests__/                    # Jest unit tests
```

### 1.4 What each major file is responsible for

| File | Responsibility |
| --- | --- |
| `app/_layout.tsx` | Mounts `AuthProvider` once for the whole app and defines the top-level `Stack` navigator. |
| `app/(main)/_layout.tsx` | The **gatekeeper**. While the session is loading it shows a spinner; with no session it `<Redirect>`s to `/sign-in`; otherwise it wraps all child screens in `AppQueueProvider` so every screen can reach the upload queue. |
| `app/sign-in.tsx` | Calls `supabase.auth.signInWithPassword` / `signUp`. If a session already exists it redirects to `/`. |
| `app/(main)/index.tsx` | Lists trips (`listTrips`), shows the "X Pending Uploads" banner, long-press to delete, sign-out (blocked while uploads are pending), and the "keep a copy in Files" switch. |
| `app/(main)/trip/[id]/index.tsx` | The workspace. Loads the trip, its cars and its photo rows; combines them with the live queue to decide each angle tile's state; opens the lot-number modal; navigates to `/camera`. |
| `app/(main)/camera.tsx` | Thin wrapper. Owns the "which angle am I on" state, turns a captured photo into a queue job, and auto-advances to the next missing angle. |
| `src/components/CameraViewfinder.tsx` | Everything hardware: permissions, lens choice, the preview, the shutter button and the volume-key shutter. |
| `src/lib/uploadQueue.ts` | The offline queue engine. |
| `src/lib/api.ts` | Every read/write on `trips`, `cars`, `photos`, including the lot-number rename. |

### 1.5 Providers and hooks: how screens share state

Three React contexts sit above your screens:

1. `AuthProvider` (`src/lib/auth.tsx`) holds `{ session, ready }`. `ready` stays `false` until the first
   `getSession()` finishes, so guards don't flash a redirect. It also subscribes to `onAuthStateChange`, so
   signing out anywhere instantly re-renders the guard, which redirects to `/sign-in`.
2. `AppQueueProvider` (`src/lib/appQueue.tsx`) creates **one** `UploadQueue` per signed-in user
   (`useMemo(..., [userId])`), starts it with `queue.load()`, and installs the network/foreground triggers.
3. `useUploadJobs()` (`queueContext.tsx`) subscribes a component to the queue, so `PendingBanner`, the workspace
   and the gallery re-render whenever a job changes.

---

## 2. Database and security (the "why")

The migration is `supabase/migrations/20260929170000_lasfotos_schema.sql`. It is idempotent (`if not exists`,
`drop policy if exists`), so it is safe to re-run.

### 2.1 The three tables

```
auth.users ──< trips ──< cars ──< photos
   (Supabase)   one load    one vehicle   one image per angle
```

**trips**: one truck load on one date at one place.

| column | notes |
| --- | --- |
| `id uuid` | primary key, `gen_random_uuid()` |
| `user_id uuid` | owner. `default auth.uid()` fills it from the login token; `on delete cascade` from `auth.users` |
| `location_name text` | must not be blank (CHECK) |
| `trip_date date` | the date the driver picked |
| `created_at timestamptz` | |

**cars**: the vehicles on a trip.

| column | notes |
| --- | --- |
| `trip_id` | `on delete cascade`: delete the trip, its cars go too |
| `user_id` | owner (denormalized so RLS can check it cheaply) |
| `lot_number text` | **null until entered**. CHECK: only `A-Z a-z 0-9 _ . -` so it's always safe inside a file name |
| `position int` | 1..N order on the truck. `UNIQUE (trip_id, position)` |
| partial unique index | `(trip_id, lot_number) WHERE lot_number IS NOT NULL` (see 2.4) |

**photos**: at most one row per car per angle.

| column | notes |
| --- | --- |
| `car_id` | `on delete cascade` |
| `angle text` | CHECK in the 7 allowed values (`top, front, driver_side, back, passenger_side, keys, under_vehicle`) |
| `storage_path text` | where the file lives in the bucket (no URL; the bucket is private) |
| `UNIQUE (car_id, angle)` | this is what makes `upsert ... onConflict: 'car_id,angle'` work: a retake *replaces* the row |
| `updated_at` | kept fresh by the `touch_updated_at` trigger |

**Why cascade deletes matter:** deleting a trip removes cars and photo *rows* automatically. Postgres cannot
delete the *files* in Storage, so `deleteTrip()` in `api.ts` first lists and removes the
`{user_id}/{trip_id}/` objects, and only then deletes the trip row. If the file removal fails, the trip is not
deleted, so you never get orphaned files with no row pointing at them.

### 2.2 Row Level Security in plain English

RLS makes Postgres add a hidden `WHERE` clause to every query, based on **who is asking**. The "who" comes from
the JWT access token that supabase-js attaches to each request; inside SQL, `auth.uid()` returns that user's id.
Without policies, an RLS-enabled table returns nothing and rejects every write.

Here is the `trips` policy set with comments:

```sql
alter table public.trips enable row level security;   -- turn the mechanism on

-- READ: you only see rows whose owner is you.
create policy trips_select on public.trips
  for select                                  -- applies to SELECT queries
  to authenticated                            -- only signed-in users (anon gets nothing)
  using ((select auth.uid()) = user_id);      -- the hidden WHERE clause

-- CREATE: the new row must be owned by you.
create policy trips_insert on public.trips for insert to authenticated
  with check ((select auth.uid()) = user_id); -- WITH CHECK validates the row being written

-- CHANGE: you may only touch your rows (USING) and the result must still be yours (WITH CHECK).
create policy trips_update on public.trips for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- REMOVE: only your rows.
create policy trips_delete on public.trips for delete to authenticated
  using ((select auth.uid()) = user_id);
```

Why each detail is written this way:

- **`to authenticated`** limits the policy to signed-in users. Additionally the migration runs
  `revoke all ... from anon`, so an unauthenticated caller can't even reach the tables.
- **`(select auth.uid())` instead of `auth.uid()`**. Wrapping it in a `select` lets Postgres compute it once per
  query instead of once per row. Same meaning, much faster on large tables.
- **`USING` vs `WITH CHECK`.** `USING` filters which existing rows you may see/modify. `WITH CHECK` validates
  the *new* row. On UPDATE you need both; without `WITH CHECK` a user could edit their own row and set
  `user_id` to someone else's id, "giving away" (or planting) data.
- **`user_id ... default auth.uid()`.** The client never has to send its own id, and can't forge one: even if it
  sends a different `user_id`, the `WITH CHECK` fails.
- **Every operation has its own policy** (select/insert/update/delete) instead of one `for all` policy, so each
  rule is explicit and easy to audit.

**Child tables also check the parent.** A `user_id` column alone is not enough for `cars` and `photos`. Imagine
user B inserting `{ trip_id: <A's trip>, user_id: <B's id> }`. B owns the new row, but it would be attached
to A's trip. So insert/update policies add an ownership check on the parent:

```sql
create policy cars_insert on public.cars for insert to authenticated
  with check (
    (select auth.uid()) = user_id                       -- the car is mine...
    and exists (                                        -- ...AND the trip it points to is mine
      select 1 from public.trips t
      where t.id = trip_id and t.user_id = (select auth.uid())
    )
  );
```

`photos` does the same against `cars`. `scripts/verify-backend.mjs` proves this: "user B cannot attach a car to
A's trip" and "cannot attach a photo to A's car" both pass.

**Storage policies** protect the files the same way. `storage.objects` has no `user_id` column, so ownership is
encoded in the **path**: the first folder must be your user id.

```sql
create policy fotos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'fotos'                                              -- only this bucket
    and (storage.foldername(name))[1] = (select auth.uid())::text    -- first path segment == my id
  );
```

`storage.foldername('u1/t1/123_front.jpg')` returns `{u1, t1}`; `[1]` is `u1`. There are four policies
(select, insert, update, delete) because:

- **Upload with `upsert: true` needs INSERT + SELECT + UPDATE.** With only INSERT, first uploads work but retakes
  silently fail.
- **`storage.move` (the lot-number rename) needs UPDATE.**
- **Creating a signed URL needs SELECT.** So user B asking to sign A's file is refused.

The bucket itself is `public = false`, `image/jpeg` only, 10 MiB per file (set in the migration).

**What the multi-user guarantee rests on:** the database enforces it, not the app. Even if someone extracted the
publishable key from the APK and wrote their own client, they could still only see their own rows and files.

### 2.3 What the backend self-test proves

`node scripts/verify-backend.mjs` creates two throwaway users and runs 29 checks against the live server, then
deletes them. It covers: RLS isolation (reads, writes, cross-attachment), unsafe lot numbers rejected, duplicate
lot numbers rejected, JPEG-only uploads, private bucket (public URL does not serve), signed URLs work, rename via
`move`, and delete cascade. Re-run it after any migration change.

### 2.4 Storage path structure and the duplicate-lot problem

```
fotos/{user_id}/{trip_id}/{lot_number}_{angle_tag}.jpg

fotos/feafb4a1-.../9c1d2e3f-.../123456_driver.jpg
       ^ RLS folder  ^ groups a trip  ^ what a human reads in Files
```

- `user_id` first: the storage policy only looks at segment 1.
- `trip_id` second: all files of one trip share a "folder", so listing/deleting a trip is a prefix operation.
- `{lot_number}_{angle_tag}` last: readable names. Tags are `top, front, driver, back, passenger, keys, under`.

**The collision problem.** If two cars had the same lot number, both would write `123456_front.jpg` and the
second upload (with `upsert`) would silently overwrite the first car's photo. Two rules prevent it:

1. Database: `create unique index cars_trip_lot_number_key on cars (trip_id, lot_number) where lot_number is not null`.
   Saving a duplicate fails with Postgres error `23505`, and `setLotNumber()` turns that into the friendly
   message "That lot number is already used in this trip". The `where ... is not null` part lets any number of
   cars have *no* lot number yet.
2. Code: `photoObjectPath()` in `lotPhotos.ts` is the **only** place paths are built, so the format can't drift.

```ts
// src/lib/lotPhotos.ts
export function photoObjectPath(userId: string, tripId: string, lotNumber: string, angle: Angle): string {
  const prefix = tripPrefix(userId, tripId);        // validates both ids, returns "user/trip"
  const lot = sanitizeLotNumber(lotNumber);         // trim + strip anything outside [A-Za-z0-9_.-]
  if (!lot) throw new WaitingForLotNumber();        // no lot yet -> the queue will wait, not fail
  return `${prefix}/${lot}_${ANGLE_FILE_TAG[angle]}.jpg`;
}
```

**Changing a lot number after photos exist.** Because the lot is in the file name, the files must be renamed.
`setLotNumber()` in `api.ts` does this in a safe order:

1. Update `cars.lot_number` first (the unique index catches duplicates *before* anything is moved).
2. For each existing photo: `storage.move(old, new)`, then update `photos.storage_path`.
3. If anything fails, undo the moves in reverse and restore the old lot number.

A rename needs internet, so it calls `requireOnline()` first and shows "Connect to the internet to do this".

---

## 3. The offline queue and data flow

### 3.1 The life of one photo, step by step

```
 tap angle tile ──> /camera ──> shutter ──> takePictureAsync ──> enqueue ──┐
                                                                            │  (immediately persisted)
   ┌────────────────────────────────────────────────────────────────────────┘
   v
 [AsyncStorage]  job saved
   │
   v   pump() loop picks the job
 compress (1600px, q 0.8) ──> copy into app documents/upload-queue/
   │
   v
 save LasFotos album copy (if enabled)  ──> visible in Gallery and the Files app
   │
   v
 look up car's CURRENT lot number ──> build path ──> storage.upload(upsert)
   │
   v
 upsert photos row (car_id, angle) ──> delete queued file ──> remove job ──> UI refreshes
```

**Step 1: Open the camera.** In the workspace, `shoot(car, angle)` pushes the route
`/camera?tripId=…&carId=…&angle=…&lot=…`. If the car has no lot number, it opens the lot-number modal instead.

**Step 2: Press the shutter.** The on-screen button and the volume keys both call the same `shoot()` in
`CameraViewfinder.tsx`:

```ts
async function shoot() {
  if (shooting.current || !cameraRef.current) return;      // ignore a press while a capture is running
  shooting.current = true;
  setBusy(true);
  try {
    const photo = await cameraRef.current.takePictureAsync({ quality: 1 }); // full-quality original in the cache
    onShot({ uri: photo.uri, width: photo.width, height: photo.height });   // hand it to camera.tsx
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Could not take the photo');
  } finally {
    shooting.current = false;                              // the viewfinder stays mounted for the next angle
    setBusy(false);
  }
}
```

**Step 3: Enqueue (this is the moment the photo becomes "safe").** `camera.tsx` builds a job and hands it to the
queue *before* any network work:

```ts
queue.enqueue({
  id: `${carId}:${angle}`,        // deterministic id: a retake of the same angle REPLACES the queued job
  localUri: photo.uri, width, height, fileName, lotNumber,
  carId, tripId, userId, angle,
});
```

Then it fires a haptic pulse, adds the angle to the "done" set, and moves to the next missing angle (or closes
after the seventh). The driver never waits for an upload.

**Step 4: Compress** (`src/lib/compress.ts`) uses `expo-image-manipulator`:

```ts
const size = resizeToMaxEdge(width, height, 1600);          // null if already <= 1600px (never enlarges)
const actions = size ? [{ resize: size }] : [];             // only resize when needed
const result = await manipulateAsync(uri, actions, {
  compress: 0.8,                                            // JPEG quality 80%
  format: SaveFormat.JPEG,
});
// Copy from the cache (which Android may clear) to the app's document directory (which it won't):
const dir = new Directory(Paths.document, 'upload-queue');
const dest = new File(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
await new File(result.uri).copy(dest);
```

`resizeToMaxEdge` keeps the aspect ratio: it scales so the *longest* side is 1600px. The document-directory copy
is what makes the queue crash-safe: if the app dies before uploading, the JPEG is still on disk.

**Step 5: Local copy** (`src/lib/deviceAlbum.ts`) uses `expo-media-library`. If the home-screen switch "Keep a
copy in Files" is on, the queue copies the compressed JPEG to a temp file named `{lot}_{angle_tag}.jpg` and calls
`Asset.create(file, album)` on an album called `LasFotos` (creating the album on first use). The copy is named
that way so the driver can recognise files in the Files app. It needs the *photo* permission; if refused, the
job stays queued with the error "Allow photo storage…" and the viewfinder shows an "Allow photo storage" button.
This step happens *before* the upload so a device copy exists even if the upload keeps failing.

**Step 6: Upload** (`src/lib/photos.ts`):

```ts
export async function uploadJpeg(job: UploadJob, jpegUri: string): Promise<void> {
  // The path uses the car's lot number AS IT IS NOW, not what it was at capture time.
  const path = await currentTarget(job);              // reads cars.lot_number, throws WaitingForLotNumber if blank
  if (job.storagePath !== path) {                     // skip re-uploading if a previous attempt already did
    const body = await readLocalBytes(jpegUri);
    await supabase.storage.from('fotos').upload(path, body, { contentType: 'image/jpeg', upsert: true });
    job.storagePath = path;                           // remembered on the job (persisted with it)
    const finalPath = await currentTarget(job);       // did the lot number change mid-upload?
    if (finalPath !== path) { await supabase.storage.from('fotos').move(path, finalPath); job.storagePath = finalPath; }
  }
  // Record it in the database. onConflict makes a retake overwrite instead of adding a second row.
  await supabase.from('photos').upsert(
    { user_id: job.userId, car_id: job.carId, angle: job.angle, storage_path: job.storagePath },
    { onConflict: 'car_id,angle' },
  );
  new File(jpegUri).delete();                         // the queued JPEG is no longer needed
}
```

Splitting "upload file" from "write DB row" means a failure between them is recoverable: the job remembers
`storagePath`, so the retry only redoes the missing row write.

**Step 7: Done.** The queue removes the job, tells listeners (`onUploaded`), and screens reload so the tile flips
from "Sending" to "Saved".

### 3.2 Deep dive: the offline queue

The engine is `UploadQueue` in `src/lib/uploadQueue.ts`. It is deliberately **pure TypeScript with injected
dependencies**, so tests can drive it with fake compress/upload/sleep/clock functions. The real wiring is in
`appQueue.tsx`.

#### What a job looks like

```ts
type UploadJob = {
  id: string;             // `${carId}:${angle}`
  localUri: string;       // the JPEG on disk (original at first, compressed after step 4)
  width: number; height: number;
  lotNumber?: string;     // only used to name the album copy
  carId; tripId; userId; angle;
  storagePath?: string;   // set once the file is in the bucket
  compressed?: boolean;   // compress only once (see below)
  savedLocally?: boolean; // album copy done, don't duplicate it on retry
  attempts: number;
  status: 'pending' | 'uploading' | 'failed' | 'waiting';
  nextAttemptAt: number;  // epoch ms: don't try before this time
  lastError?: string;
};
```

The flags (`compressed`, `savedLocally`, `storagePath`) make each pipeline stage **resumable**: after a failure
the job continues from the stage that broke, instead of redoing (and degrading, or duplicating) earlier work.
Re-compressing an already-compressed JPEG on every retry would lower quality each time, hence `compressed`.

#### How pending jobs are saved (AsyncStorage)

`AsyncStorage` is a simple on-device key/value store that survives app restarts. The queue serialises the whole
job list as one JSON string under a per-user key:

```ts
// src/lib/appQueue.tsx
function asyncStorageQueue(userId: string): QueueStorage {
  const key = `lasfotos-upload-queue:${userId}`;      // per-user: another account can never upload these jobs
  return {
    async load() {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return [];
      try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
      catch { return []; }                             // corrupted JSON -> start empty instead of crashing
    },
    async save(jobs) { await AsyncStorage.setItem(key, JSON.stringify(jobs)); },
  };
}
```

Inside `UploadQueue`, `persist()` calls `storage.save(this.list())`. It is called at every state change:
after `enqueue`, after compression, after the album copy, after a failure, and after success. So AsyncStorage
always mirrors memory closely enough that a crash loses at most the last few milliseconds of bookkeeping,
never the photo itself (the JPEG is a file, the job is a pointer to it).

#### The pump loop (annotated)

```ts
private async pump(): Promise<void> {
  if (this.pumping || this.stopped) return;             // only ONE loop runs at a time
  this.pumping = true;
  try {
    while (!this.stopped) {
      const now = this.deps.now();
      const ready = this.jobs.find((job) => job.nextAttemptAt <= now);   // a job whose time has come

      if (!ready) {
        const waiting = [...this.jobs].sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
        if (!waiting) break;                            // queue empty -> loop ends
        // Sleep until the earliest retry time, OR until somebody calls retryNow() (wake).
        await Promise.race([
          this.deps.sleep(Math.max(0, waiting.nextAttemptAt - now)),
          new Promise<void>((resolve) => { this.wake = resolve; }),
        ]);
        this.wake = null;
        continue;
      }

      ready.status = 'uploading';
      this.emit();                                      // UI: tile shows "Sending"
      try {
        if (!ready.compressed) {                        // stage 1: compress once
          const c = await this.deps.compress(ready);
          if (this.stopped || !this.jobs.includes(ready)) continue;   // job cancelled/replaced meanwhile
          ready.localUri = c.uri; ready.compressed = true; this.persist();
        }
        if (this.deps.saveLocal && !ready.savedLocally) {             // stage 2: album copy once
          await this.deps.saveLocal(ready, ready.localUri);
          if (this.stopped || !this.jobs.includes(ready)) continue;
          ready.savedLocally = true; this.persist();
        }
        await this.deps.upload(ready, ready.localUri);                // stage 3: cloud
        if (this.stopped || !this.jobs.includes(ready)) continue;
        for (const l of this.uploadedListeners) l({ ...ready });      // tell screens to reload
        this.jobs = this.jobs.filter((j) => j !== ready);             // success: remove the job
        this.emit(); this.persist();
      } catch (err) {
        if (!this.jobs.includes(ready)) continue;
        const waiting = err instanceof Error && err.name === 'WaitingForLotNumber';
        if (!waiting) ready.attempts += 1;              // "no lot yet" is not a failure
        ready.status = waiting ? 'waiting' : 'failed';
        ready.lastError = waiting ? undefined : (err instanceof Error ? err.message : 'Could not send the photo');
        // failure: back off 1s, 2s, 4s ... capped at 30s.  waiting: look again in 1s.
        ready.nextAttemptAt = this.deps.now() + (waiting ? 1_000 : backoffMs(ready.attempts));
        this.emit(); this.persist();
      }
    }
  } finally {
    this.pumping = false;
    // (re-arm if another job became ready while we were finishing; resolve whenDrained() waiters)
  }
}

const backoffMs = (attempts: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, attempts - 1));
```

Jobs are processed one at a time, in order. A failure does not block others: the failed job gets a future
`nextAttemptAt`, so `find(...)` skips it and moves on.

The two "guard" lines (`this.stopped || !this.jobs.includes(ready)`) handle races: the driver may retake the same
angle (which *replaces* the job object) or delete the car/trip (`cancelCar`/`cancelTrip`) while an `await` is in
flight. If the job we were working on is no longer in the list, we abandon our stale reference.

**The `waiting` state.** The upload path is built from the car's *current* lot number. If that is blank when the
job runs (for example the car's lot number was cleared or the job outlived a change), `photoObjectPath` throws
`WaitingForLotNumber`. The queue parks the job as `waiting` (it does not count as a failed attempt) and re-checks
after 1 s. When the workspace saves a lot number it calls `queue.releaseCar(carId)`, which flips that car's
waiting jobs back to `pending` so they go out immediately. In normal use the angle tiles open the lot modal
first, so this is a safety net rather than a common path.

#### What happens on restart

`UploadQueueProvider` runs `queue.load()` once when it mounts:

```ts
async load() {
  const stored = await this.deps.storage.load();               // read AsyncStorage
  const byId = new Map();
  for (const raw of stored) { const job = reviveUploadJob(raw); if (job) byId.set(job.id, job); }
  for (const job of this.jobs) byId.set(job.id, job);          // anything enqueued since mount wins
  this.jobs = [...byId.values()];
  this.emit();                                                 // banner appears immediately
  void this.pump();                                            // start uploading
}
```

`reviveUploadJob` validates required fields (bad records are dropped) and normalises status: a job that was
mid-`uploading` when the app died comes back as `pending` with `nextAttemptAt: 0`, i.e. "try now". Thanks to
`compressed` / `savedLocally` / `storagePath`, it resumes at the right stage.

#### How retries fire when the network returns

There are **three** independent triggers. All of them end in the same place, `queue.retryNow()`.

1. **The backoff timer.** The pump's own `sleep` wakes the loop at each job's `nextAttemptAt`. Even with no
   network signal at all, a failed job is retried at most every 30 s.
2. **NetInfo: offline → online.** In `appQueue.tsx`:

   ```ts
   function QueueTriggers({ queue }) {
     useEffect(() => {
       let wasOnline = true;
       const unsubscribeNet = NetInfo.addEventListener((state) => {
         const online = state.isConnected !== false && state.isInternetReachable !== false;
         if (online && !wasOnline) queue.retryNow();       // only on the TRANSITION back to online
         wasOnline = online;
       });
       const appState = AppState.addEventListener('change', (next) => {
         if (next === 'active') queue.retryNow();          // 3. app returns to the foreground
       });
       return () => { unsubscribeNet(); appState.remove(); };   // clean up listeners on unmount
     }, [queue]);
     return null;
   }
   ```

3. **App foregrounded.** The driver switches back from another app or unlocks the phone.

`retryNow()` makes a backing-off job eligible immediately and wakes the sleeping loop:

```ts
retryNow(): void {
  for (const job of this.jobs) {
    if (job.status !== 'failed') continue;
    job.nextAttemptAt = 0;     // eligible right now
    job.attempts = 0;          // reset the backoff ladder to 1s
  }
  this.wake?.();               // resolves the Promise.race inside pump(), skipping the rest of the sleep
  void this.pump();            // and start a loop if none is running
}
```

Without the `Promise.race`/`wake`, a job that just failed and is sleeping for 30 s would keep waiting even though
the signal is back.

**Other safety nets:** `appQueue.tsx` also wraps `uploadJpeg`; if the error looks like an expired token
(`jwt`, `401`, `expired`…) it calls `supabase.auth.refreshSession()` before rethrowing, so the next retry has a
fresh token. And sign-out is blocked while `jobs.length > 0`, because the queue is scoped to the user; signing out
would strand the photos.

---

## 4. Hardware integrations (camera and volume buttons)

The stock `expo-camera` and `react-native-volume-manager` packages don't do quite what a yard app needs on
Android. The repo fixes that with **postinstall patches** (`scripts/patch-*.mjs`) that edit the packages inside
`node_modules` right after `npm install` (EAS also runs `npm install`, so cloud builds get them). The patches
change native Kotlin/Java source, so this only takes effect in a **native build**, not in Expo Go. The patches
target Android, the platform this app ships on.

### 4.1 Choosing the widest lens

Phones expose several rear cameras (main, ultrawide, telephoto), sometimes as one "logical" camera that zooms
below 1x to reach the ultrawide. The stock library can't list them or ask for 0.5x. Three pieces cooperate:

1. **Patch: device list** (`patch-expo-camera.mjs`) adds a native function `getAvailableCameraDevicesAsync()`.
   On Android it asks Camera2 for each camera's id, facing (front/back), focal lengths, and the **minimum zoom
   ratio**. A logical camera with `minZoom < 1` (say 0.5) is effectively an ultrawide.
2. **JS: pick** (`src/lib/cameraDevices.ts`):

   ```ts
   export function selectWidestBackCamera(devices: CameraDevice[]): WidestCameraChoice {
     const back = devices.filter((d) => d.position === 'back');        // rear cameras only
     const namedUltra = back.filter(isUltrawide);                      // ones whose name says "ultra"
     const dedicatedNamed = namedUltra.find((d) => d.focalLengths?.length === 1);
     // Preference order: smallest zoom (<0.99) -> dedicated ultrawide -> any "ultra" -> shortest focal length -> first
     const chosen = widestZoom(back) ?? dedicatedNamed ?? namedUltra[0] ?? shortestFocal(back) ?? back[0];
     return { deviceId: chosen?.id, selectedLens: ..., zoom: 0, useWidestZoom: true };
   }
   ```

3. **Patch: use it.** The patched `CameraView` accepts two extra props, `cameraId` (open exactly this camera) and
   `useWidestZoom` (treat `zoom={0}` as *the camera's minimum zoom ratio*, e.g. 0.5x, instead of 1x).
   `patch-camera-zoom.mjs` adds a fix: CameraX publishes its real zoom range a moment after start, and the stock
   code would write zoom 0 as 1x before then, so the patch re-applies the minimum when the range arrives.

In `CameraViewfinder.tsx`:

```tsx
<WidestCamera
  key={forceDefault ? 'default-back' : 'widest-back'}   // changing the key remounts the camera
  ref={cameraRef}
  facing="back"
  zoom={choice.zoom}                                     // 0 -> "widest"
  cameraId={forceDefault ? undefined : choice.deviceId}  // the chosen physical/logical camera
  useWidestZoom={choice.useWidestZoom}
  onMountError={(e) => {
    if (!forceDefault && choice.deviceId) { setForceDefault(true); return; }  // fallback: default back camera
    setError(e.message || 'The camera preview did not start');
  }}
/>
```

If the chosen camera fails to open, the component retries once on the default rear camera (`forceDefault`),
which still requests widest zoom. The viewfinder is rendered full-screen, outside any ScrollView, with explicit
`width`/`height`: a camera preview inside a scrolling parent can collapse to zero height.

### 4.2 The volume buttons as a shutter: the lifecycle

**The problem.** On Android, pressing a volume key is handled by the OS *before* your app: it changes the
ringer/media level and pops up the slider. To use the keys as a shutter you must (a) intercept the key events
and (b) stop the system from acting on them. The library's `showNativeVolumeUI({ enabled: false })` is the
switch that means "the app owns the volume keys now". The patch (`patch-volume-shutter.mjs`) makes that
reliable.

**Why disabling the system volume UI is critical.** If the OS still handles the key, every photo would also
change the volume (a driver could silence their phone or blast it) and a slider would cover the viewfinder.
Intercepting the event and *consuming* it (returning `true`) means Android considers it handled and does nothing.

**The whole loop, in one picture:**

```
 volume key pressed
        |
 Android Activity Window.Callback  <-- patched proxy (native) intercepts dispatchKeyEvent
        |  consumeVolumeKey():
        |     - only VOLUME_UP / VOLUME_DOWN
        |     - only on ACTION_DOWN with repeatCount 0 (ignores key-repeat while held)
        |     - 300 ms debounce
        |     - emits JS event "RNVMEventHardwareVolume"
        |     - returns true  => the OS never changes the volume
        v
 JS: NativeEventEmitter listener (src/lib/volumeShutter.ts) -> 300 ms debounce -> onPress()
        v
 shootRef.current()  ->  shoot()  ->  takePictureAsync()
```

**JS side** (`src/lib/volumeShutter.ts`):

```ts
export async function startVolumeShutter(onPress: () => void, api = nativeVolumeApi) {
  if (Platform.OS === 'web') return { stop() {} };

  await api.showNativeVolumeUI({ enabled: false });   // 1. take over the keys, hide the system slider
  let lastPress = 0;
  let listener;
  try {
    listener = api.addHardwareVolumeListener(() => {  // 2. subscribe to the native event
      const now = Date.now();
      if (now - lastPress < 300) return;              //    debounce double-triggers
      lastPress = now;
      onPress();
    });
  } catch (err) {
    void api.showNativeVolumeUI({ enabled: true });   // if subscribing failed, give the keys back at once
    throw err;
  }

  return {
    stop() {                                           // 3. the undo button
      listener.remove();                               //    unsubscribe
      void api.showNativeVolumeUI({ enabled: true });  //    restore normal volume behaviour + slider
    },
  };
}
```

**Where it's started and stopped: the React effect** (`CameraViewfinder.tsx`):

```tsx
useEffect(() => {
  if (!showCamera) return;                 // only once the preview is actually on screen
  let live = true;                         // "is this effect still current?"
  let shutter: { stop: () => void } | null = null;

  startVolumeShutter(() => shootRef.current())   // shootRef always points at the latest shoot()
    .then((started) => {
      if (!live) started.stop();           // unmounted BEFORE startup finished -> undo immediately
      else shutter = started;              // otherwise remember it so cleanup can stop it
    })
    .catch(() => undefined);

  return () => {                           // the cleanup function React runs on unmount
    live = false;
    shutter?.stop();                       // remove listener + restore the volume UI
  };
}, [showCamera]);
```

**How restoration is guaranteed, layer by layer:**

1. *React cleanup.* A `useEffect` cleanup runs whenever the component unmounts *or* `showCamera` flips to
   `false`. Every way of leaving the camera unmounts it: the "Done" button and Android back both call
   `router.back()` (the Android back handler is registered in the same component and routed to `onClose`), and
   finishing the seventh angle calls `router.back()` too. Unmount → cleanup → `stop()` →
   `showNativeVolumeUI({ enabled: true })`.
2. *The `live` flag closes a race.* `startVolumeShutter` is async. If the driver leaves the screen during that
   window, the effect's cleanup has no `shutter` to stop yet. The `.then` sees `live === false` and stops it
   itself, so the keys are never left captured.
3. *The catch inside `startVolumeShutter`.* If registering the listener throws, it restores the UI before
   rethrowing.
4. *Native side.* `showNativeVolumeUI(true)` calls `cleanupKeyListener()`, which bumps a "generation" counter
   (cancelling any scheduled setup retries) and `removeWindowShutter()`, which puts the Activity's **original**
   `Window.Callback` back. Nothing of the patch stays installed. If the app is backgrounded and resumed while the
   camera is open, `onHostResume` re-arms the interception, but only while the UI is still disabled.
5. *Process death.* The interception lives in the app's own window, not in system settings, so killing the app
   can't leave the phone in a modified state.

**A caveat worth knowing (blur vs unmount).** The camera is its own route stacked *above* the workspace, and
nothing is ever pushed on top of it, so "leaving the camera" always equals "unmounting the camera". That's why a
plain `useEffect` cleanup is enough. React Navigation keeps screens mounted when another screen is pushed *over*
them. If you later add a screen that opens on top of `/camera` (a settings sheet, say), the camera would stay
mounted, its cleanup would not run, and the volume keys would remain captured. In that case, switch the effect to
`useFocusEffect` (from `expo-router`), which runs cleanup on **blur** as well as unmount:

```tsx
useFocusEffect(useCallback(() => {
  let live = true, shutter = null;
  startVolumeShutter(() => shootRef.current()).then((s) => (live ? (shutter = s) : s.stop()));
  return () => { live = false; shutter?.stop(); };   // runs on blur AND unmount
}, []));
```

---

## 5. Signed URLs and private data

The `fotos` bucket is **private**: `https://<project>/storage/v1/object/public/fotos/<path>` returns an error (the
self-test asserts that). To display a private image, the app asks Supabase for a **signed URL**: a normal HTTPS
link with a cryptographic signature and expiry time in the query string, which lets whoever holds it fetch
that one file until it expires.

### 5.1 Who is allowed to get one

Signing is a storage operation that goes through the same policies. The request runs as the signed-in user, and
only succeeds if the `fotos_select` policy lets them read that object (their own user-id folder). User B asking to
sign one of A's paths simply gets no URL back (proved in `verify-backend.mjs`). So the guarantee is:
**you can only obtain links to your own photos.**

### 5.2 How the Gallery does it (`gallery.tsx` + `photos.ts`)

```ts
// src/lib/photos.ts  - batch signing
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage
    .from('fotos')
    .createSignedUrls(paths, SIGNED_URL_TTL);          // ONE request for all paths; TTL = 3600 s (1 hour)
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  return urls;                                          // { "user/trip/123456_front.jpg": "https://...token=..." }
}
```

`createSignedUrls` (plural) takes an array, so a 9-car trip with 63 photos costs one API call, not 63.

The gallery's `load()`:

```ts
const [nextCars, nextPhotos] = await Promise.all([listCars(id), listTripPhotos(id)]); // 1. DB rows (RLS-filtered)
setUrls(await signedUrls(nextPhotos.map((p) => p.storage_path)));                     // 2. paths -> signed URLs
```

1. `listTripPhotos` gets the photo rows for the trip using a join filter
   (`photos` → `cars!inner(trip_id)` `.eq('cars.trip_id', tripId)`). Rows carry `storage_path`, not a URL. This
   is why the schema has no `image_url` column: a URL would expire, a path never does.
2. The paths are signed in one batch and stored as `path → url` in state.
3. The screen renders `<Image source={{ uri: signedUrl }} />`. React Native downloads the JPEG straight from
   Supabase Storage with the signature in the link; no auth header is needed.

### 5.3 Freshness, pending photos and expiry

- **Reload triggers.** The gallery re-runs `load()` whenever the screen gains focus and whenever the queue
  reports an upload finished (`queue.onUploaded`). Every reload re-signs, so URLs never go stale while the
  screen is in use, even after the phone slept for hours.
- **Photos still in the queue.** These have no `storage_path` yet, so the gallery merges in the queue's jobs and
  shows the local file (`job.localUri`) with a yellow "PENDING" label. Nothing looks missing while offline.
- **Expiry.** After 1 hour a copied link stops working. That's a feature: a leaked link is only briefly useful.
  Treat a signed URL like a password: don't log it or store it long-term. Anyone holding a valid one can view the
  photo without logging in.

### 5.4 Summary of the private-data design

| Layer | What it enforces |
| --- | --- |
| Bucket `public = false` | No unauthenticated URL works |
| Storage RLS (`foldername[1] = auth.uid()`) | You can only list, sign, upload, move or delete inside your own folder |
| Table RLS + parent checks | You can only see and attach your own trips, cars and photo rows |
| `storage_path` column instead of URLs | Nothing that expires is stored; links are minted on demand |
| Short TTL | Leaked links die on their own |

---

## Appendix: where to look when...

| Question | Start here |
| --- | --- |
| "Why can't user X see this trip?" | The RLS policies in the migration; `scripts/verify-backend.mjs` |
| "A photo shows Sending forever." | `PendingBanner`, `job.lastError`, then `uploadJpeg` in `photos.ts` |
| "Volume keys change the ringer." | `patch-volume-shutter.mjs` applied? Are you in a *native* build, not Expo Go? |
| "Preview isn't ultra-wide." | `queryCameraDevices()` output, `selectWidestBackCamera`, the zoom patch |
| "Sign-in says the URL/key are missing." | Expo dashboard variables and the profile's `environment` in `eas.json` |
| "Change the look." | `theme.ts` only; components don't hardcode colors or sizes |
| "Change how a file is named." | `photoObjectPath` in `lotPhotos.ts` and the storage-path section of the migration |


---

## 6. Notes (trip notes and lot notes)

Two nullable text columns: `trips.notes` (max 2000 chars) and `cars.notes` (max 200), added by
`supabase/migrations/20260929230000_notes.sql`. They are plain metadata: no storage paths depend on them, and the existing
RLS policies already cover them because those policies are row-level (`user_id = auth.uid()`).

**Autosave** (`src/lib/autosave.ts`, hook `src/lib/useAutosave.ts`). `Autosaver` is a small framework-free class:

```ts
saver.change(text);   // every keystroke: remember the text, restart an 800 ms timer
saver.flush();        // save NOW: used on blur, on Done, and when the component unmounts
```

Rules it enforces (all unit-tested in `__tests__/notes.test.ts`): nothing is written when the text equals what is stored;
only one save runs at a time and text typed during a save is saved right after; a failed save reports `error` and is
retried only by the next edit or a tap on "Not saved, tap to retry" (no endless retry loop). Flushing on unmount matters
because `onBlur` does not fire when the driver taps Back with the keyboard open.

**UI.** The trip note is a multiline `NoteField` under the trip header. A lot note is shown as a one-line preview (and a
note icon on the car row); tapping opens `NoteModal` with a single-line `NoteField` plus quick-note chips
(`QUICK_NOTES` in `src/lib/notes.ts`; edit that array to change the chips). Notes need a connection like other edits;
if offline the status line shows "Not saved" and retries on tap.

**WhatsApp (web app).** The lot note is added to the caption of the first photo of each car only:
`123456 Top - No keys; No catalytic`. See `web-app/web/src/lib/dispatch/plan.ts`.

**Angle tiles.** `touch.angleTile` is now 66 (was 88): four tiles per row, two rows instead of three, still above the 64 px
glove minimum. Labels are 12 px, so the tile shows a short name (`Pass.` for Passenger side, `Driver`, `Under`); the full name is
read by screen readers and shown in the camera header. State is shown by icon + border + fill, not by a caption.


---

## 7. Watermark ("123456 Front" stamped into every photo)

The stamp is part of the pixels, so the copy in the `LasFotos` album, the file in the upload queue, and the file in
Supabase are all the same watermarked JPEG. There is no un-stamped copy of a processed photo.

```
shutter -> raw capture (in the queue job)
        -> compressPhoto():  expo-image-manipulator: resize to 1600 px (EXIF applied), quality 1.0
                          -> react-native-image-marker: stamp "{lot} {Angle}" bottom right, encode JPEG q80  (the ONE lossy encode)
                          -> copy into app storage (upload-queue/)
        -> saveToPhotoAlbum()  (album copy)  -> upload
```

`src/lib/compress.ts` does the work; `src/lib/watermark.ts` builds the text (same words as the WhatsApp caption, full angle
name) and the pixel sizes (font = 3% of the longest edge = 48 px on a 1600 px photo; box padding and edge inset scale
with the font). Colors and scales live in `theme.ts` (`watermark`). Stamping happens in the queue's compress step
(once per photo, never on retries), so neither the album nor the upload can see an un-stamped photo. If stamping throws (for
example the native module is missing), the job fails and retries instead of storing an un-stamped photo.

Limits: the lot number is burned in at the moment the photo is processed. Renaming a lot afterwards renames the stored files
but cannot change the pixels, so photos taken under the old number keep it; retake them if that matters.
The native module needs a new development build (`npx eas-cli build -p android --profile development`).


---

## 8. Play Store release changes

**No self sign-up.** `app/sign-in.tsx` only calls `supabase.auth.signInWithPassword`; the "Create account" button and
`signUp` call are gone. Accounts are created by the administrator in Supabase Studio. A "Privacy Policy" link opens
`https://lasfotos.app/privacy` (`PRIVACY_URL` in `src/lib/links.ts`) with `Linking.openURL`.
Removing the button does not close signups on the server: set `GOTRUE_DISABLE_SIGNUP=true` in the Supabase auth service.

**Sharing photos from the gallery** (`app/(main)/trip/[id]/gallery.tsx`, `src/lib/sharePhotos.ts`,
`src/lib/selection.ts`). "Select" (or a long-press on a photo) turns on selection mode: tap photos to toggle them
(a check icon and a yellow border), "Select all / Clear" and "Cancel" are in the header, and a "Share (N)" button appears at
the bottom when at least one photo is selected. The Android back button leaves selection mode first.

`sharePhotos()` puts every selected photo into one temporary folder `cache/share-<time>/` named `{lot}_{tag}.jpg`:
photos still waiting in the upload queue are copied from their local file, uploaded ones are downloaded through their signed
URL (the bucket is private). It then opens ONE Android share sheet for all of them.

Why `react-native-share` and not `expo-sharing`: `expo-sharing`'s `shareAsync(url)` takes a single file. `react-native-share`
sends `ACTION_SEND_MULTIPLE` with FileProvider URIs, so WhatsApp, Drive and email get all photos in one go.
Temporary folders are deleted at the next share and when the gallery opens (not right after sharing: the receiving app may
still be reading them). The shared files are the watermarked JPEGs.
