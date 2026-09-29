You are an expert React Native/Expo and Supabase developer. Your mission is to build the complete database schema and mobile app for "lasfotos.app", an Android app used by car-carrier drivers to quickly log lot numbers and take seven specific photo angles of each car.

This app replaces a legacy system. It strictly focuses on photo logging—do not include any financial, pay, or expense tracking features.

The app must be heavily optimized for outdoor yard use: fast data entry, high-contrast UI (black background, white text, yellow accents) for bright sunlight, robust offline-capable persistent upload pipelines, and strict data privacy. It must support multiple users securely via Supabase Auth and Row Level Security (RLS).

**Design tokens:** All styling must use the existing `theme.ts` in this folder (colors, spacing, typography, touch sizes, `angles`, `angleState`, component presets). Do not hardcode colors, font sizes, or tap-target sizes in components.

**Reference implementation:** `/home/panda/tripTrack/` is a working, very similar app (same driver, same seven angles, same Expo + Supabase stack). Its volume-button shutter, widest-lens selection, compression, album copy, and upload queue are proven on a real device. Reuse its approach and adapt its code rather than reinventing it (see section 6). Read it, but never copy its `.env` file or any keys.

Here are the complete specifications:

## 1. Environment & Tech Stack
*   **Framework:** Latest stable Expo SDK and React Native versions (do not use speculative future SDKs). tripTrack currently runs Expo SDK 57 / React Native 0.86 / TypeScript 6; match its versions unless something is known broken.
*   **Routing:** Expo Router.
*   **Language:** TypeScript.
*   **Backend:** Supabase (Auth, Postgres, Storage).
*   **Database Credentials:** Read from `.env` (`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`). Never read or embed a service/secret key in the app.
*   **Storage:** A **private** bucket named `fotos` is already created (the migration should still set its limits: `image/jpeg` only, 10 MiB max per object).
*   **Builds:** Native camera and volume behavior does not run in Expo Go. Use a development build / EAS preview build (Android).

## 2. Database Schema & RLS (Generate the SQL Migration)
Write the complete Supabase SQL migration to create the tables, constraints, indexes, and RLS policies.

*   **trips:** `id` (uuid, default gen_random_uuid()), `user_id` (uuid, references auth.users on delete cascade, default auth.uid()), `location_name` (text, not null), `trip_date` (date, not null), `created_at` (timestamptz, default now()).
*   **cars:** `id` (uuid), `trip_id` (uuid, references trips on delete cascade), `user_id` (uuid, references auth.users on delete cascade), `lot_number` (text, null until entered), `position` (integer), `created_at` (timestamptz).
    *   `UNIQUE (trip_id, position)`.
    *   Partial unique index on `(trip_id, lot_number) WHERE lot_number IS NOT NULL` so two cars in one trip can never share a file name. The app shows an inline "Lot already used in this trip" error on conflict.
*   **photos:** `id` (uuid), `car_id` (uuid, references cars on delete cascade), `user_id` (uuid, references auth.users on delete cascade), `angle` (text, CHECK in the 7 angle keys), `storage_path` (text, not null), `created_at` (timestamptz), `updated_at` (timestamptz).
    *   `UNIQUE (car_id, angle)` — required for the upsert, so a retake replaces the row.
    *   No `image_url` column: the bucket is private, so the app derives signed URLs from `storage_path`.
*   **Indexes:** on `trips(user_id, trip_date desc)`, `cars(trip_id)`, `photos(car_id)`.
*   **Lot number rules:** Trim the value, and allow only letters, numbers, `_`, `.`, `-` (enforce with a CHECK constraint and in the input). This keeps it safe to use in a file name.
*   **Storage Path Strategy:** The lot number MUST appear in the file name, and paths must not collide.
    ```
    {user_id}/{trip_id}/{lot_number}_{angle_tag}.jpg
    ```
    Example: `feafb4a1-.../9c1d.../123456_driver.jpg`. Because lot numbers are unique per trip (index above), this cannot collide. Use short angle tags in the file name: `top`, `front`, `driver`, `back`, `passenger`, `keys`, `under` (mapping to the 7 DB angle keys). One helper builds every path so the app never hand-assembles one.
*   **Security (tables):** Enable RLS on all tables. Policies for SELECT, INSERT, UPDATE, DELETE: `user_id = auth.uid()`. Child rows must also check that the parent belongs to the user (cars → trip owned by `auth.uid()`, photos → car owned by `auth.uid()`), so a user can't attach rows to someone else's trip. Grant nothing to the `anon` role.
*   **Security (storage):** `storage.objects` has no `user_id` column. Write SELECT, INSERT, UPDATE, DELETE policies for `bucket_id = 'fotos'` with `(storage.foldername(name))[1] = auth.uid()::text`. UPDATE is required because renaming (`storage.move`) needs it.
*   **Deleting:** DB cascades remove trips → cars → photos rows, but they do NOT remove Storage files. The app must remove the objects for a trip/car (list by `{user_id}/{trip_id}/` prefix, or use the photo rows' `storage_path`) before or right after deleting the rows, and it must cancel that trip's queued uploads.

## 3. App Workflows & Navigation
Implement the UI and navigation using Expo Router.

**Connectivity assumption:** Drivers create trips and enter lot numbers the night before, on reliable Wi-Fi. Trip creation/editing and lot-number entry may therefore require a connection; if offline, show a clear "Connect to the internet to do this" message instead of failing silently. Only photo capture/upload must work offline.

**A. Authentication & Root (`/sign-in` & `/_layout`)**
*   Standard Supabase email/password sign-in and sign-up. If sign-up needs email confirmation and returns no session, tell the driver to confirm their email, then sign in.
*   Session persisted in AsyncStorage, auto token refresh.
*   Redirect to `/` upon successful auth; redirect to `/sign-in` when there is no session.

**B. Home Screen (`/`)**
*   List the user's trips, sorted by date descending.
*   Provide a swipe-to-delete or long-press option to delete a trip (with a confirm; also removes its Storage files and queued uploads).
*   Include a persistent, visible banner at the top showing "X Pending Uploads" if the offline queue has items.
*   Include a "Start New Trip" button and a "Sign Out" button. Sign Out must warn (or be blocked) while uploads are pending, since unsent photos would otherwise be stranded. Queue jobs are scoped to their `user_id` so another account on the same phone can never upload them.

**C. Trip Creation & Editing (`/trip/new` and `/trip/[id]/edit`)**
*   Requires 3 inputs: Location Name, Trip Date (manual date picker, not silently defaulted), and Car Count.
*   On creation, insert the `trips` row, then batch insert N blank `cars` rows (`position` 1..N).
*   Allow editing the car count later (appending new blank cars, or warning if trying to remove cars that already have photos; removing a car deletes its Storage files and cancels its queued uploads).

**D. Trip Details / Workspace (`/trip/[id]`)**
*   Display the list of cars for the trip.
*   If a car's `lot_number` is null, show a placeholder. Tapping opens an inline input or modal with `keyboardType="number-pad"` and `autoFocus={true}`.
*   **Lot numbers stay editable** (there is no lock). Because the lot number is part of the file name, changing it after photos exist must rename the Storage objects with `storage.move` and update each `photos.storage_path`, then release any waiting queue jobs. If the rename can't complete (offline), block the edit with a clear message rather than leaving files and rows out of sync.
*   Show the 7 required angles per car: `top`, `front`, `driver_side`, `back`, `passenger_side`, `keys`, `under_vehicle`, with `angleState` styling from `theme.ts` (empty / captured / uploading / failed). Tapping an angle opens the Camera Viewfinder. Include a "Shoot next" action that opens the first missing angle.
*   Include a "Review Trip" button that opens a gallery view.

**E. Gallery Review (`/trip/[id]/gallery`)**
*   A grid or pager screen to review all photos for a trip before leaving the yard.
*   Because the bucket is private, use Supabase `createSignedUrls` (batch) with a reasonable TTL (e.g. 1 hour) and refresh when they expire.
*   Photos still in the upload queue are shown from their local file with a "Pending" badge, so nothing looks missing.

## 4. Camera Viewfinder & Hardware (`/camera`)
Port tripTrack's proven implementation (`/home/panda/tripTrack/src/components/LotCamera.tsx`, `src/lib/cameraDevices.ts`, `cameraAccess.ts`, `cameraQuery.ts`, `volumeShutter.ts`).
*   **Component:** `expo-camera` with `facing="back"`, `zoom={0}`, and the widest back lens. Stock `expo-camera` cannot pick the Android ultrawide, so tripTrack applies postinstall patches: copy `scripts/patch-expo-camera.mjs`, `scripts/patch-camera-zoom.mjs`, and wire them in `package.json` as `postinstall` (with the volume patch below). `selectWidestBackCamera` picks the back camera with the smallest minimum zoom ratio. If that camera fails to open, retry once on the default back camera.
*   **Hardware Shutter:** `react-native-volume-manager`, patched via `scripts/patch-volume-shutter.mjs` so Android consumes the volume keys instead of changing the ringer level. Pressing Volume Up or Down triggers `takePictureAsync()`; ignore presses during an in-progress capture and debounce (~300 ms). Disable the native system volume UI while the camera is active. **Crucial:** Remove the listener and restore the system volume UI on component unmount or blur.
*   **UI Overlay:** High-contrast text showing the current lot number and angle (e.g. "LOT 123456 | FRONT") inside a semi-transparent black header (`camera.headerBg` in `theme.ts`), plus an on-screen shutter, and Android back closes the viewfinder.
*   Render the viewfinder full-screen outside any ScrollView with explicit width/height (tripTrack found the preview collapses to zero height otherwise).
*   The shot goes straight to the upload queue so the driver can open the next angle while earlier photos are still sending. Auto-advance to the next missing angle is welcome.
*   Ask for camera permission before mounting `<CameraView>`; if denied, show "Allow camera" and "Cancel".

## 5. Photo Processing & Offline Upload Pipeline
Port from tripTrack (`src/lib/compress.ts`, `resize.ts`, `uploadQueue.ts`, `queueContext.tsx`, `photos.ts`, `deviceAlbum.ts`).
*   **Compression:** After capture, `expo-image-manipulator` shrinks the JPEG so its longest edge is 1600px (never enlarge), quality `0.8`. Copy the result into the app document directory (`upload-queue/`), not the cache, so it survives until the upload finishes.
*   **Local copy (Files-accessible, not the camera roll):** Drivers need the photos reachable from the Android Files app. Save each compressed JPEG into a dedicated device album (e.g. `LasFotos`) via `expo-media-library`, using tripTrack's `deviceAlbum.ts`. Request permission only for photos. If permission is denied, show "Allow photo storage" and hold the upload until it's granted (as tripTrack does). Name the local copy with lot and angle (`{lot}_{angle_tag}.jpg`) so it is identifiable in Files. Make this copy toggleable in settings for privacy.
*   **Persistent Offline Queue:** Store the upload job in `AsyncStorage` (key scoped by user id) before attempting the upload. A job holds: id, local file URI, car id, trip id, user id, angle, attempts, status, next attempt time, saved-locally flag, last error. A newer shot of the same car+angle replaces the queued job. Jobs restore on app start.
*   **Upload:** Compute the path at upload time from the car's *current* lot number and the trip id (`{user_id}/{trip_id}/{lot_number}_{angle_tag}.jpg`), not from a value stored at capture time. If the lot number is still blank, mark the job `waiting` (not a failed attempt) until it's set. Upload with `contentType: image/jpeg`, `upsert: true`. On success upsert the `photos` row on `(car_id, angle)` with `storage_path`, delete the local queue file, and remove the job.
*   **Retry:** On failure keep the job and retry with backoff (1s, 2s, 4s… capped at 30s). Also retry immediately when connectivity returns (`@react-native-community/netinfo`) and when the app returns to the foreground (`AppState`), instead of waiting only for the timer. If a request fails with an auth error, refresh the session and retry.
*   **Driver feedback:** Each angle tile shows local photo → "Sending" / "Need lot number" / "Retrying" / "Allow photo storage" → captured. The home banner shows the pending count. Haptic feedback on capture and on upload failure.

## 6. Reuse from tripTrack
Files to port and adapt (rename the bucket to `fotos`, the album to `LasFotos`, use `storage_path` + signed URLs instead of public URLs, and the new path format):
*   `scripts/patch-expo-camera.mjs`, `scripts/patch-camera-zoom.mjs`, `scripts/patch-volume-shutter.mjs` and the `postinstall` script.
*   `src/lib/cameraDevices.ts`, `cameraAccess.ts`, `cameraQuery.ts`, `volumeShutter.ts`, `compress.ts`, `resize.ts`, `uploadQueue.ts`, `queueContext.tsx`, `deviceAlbum.ts`, `angles.ts`, and their tests in `__tests__/`.
*   Do NOT bring across trip pay, expenses, cities, weeks, money, or the `.env` file.
*   Keep the tests for the queue, upload path, compression, volume shutter, and camera-device selection passing after the adaptation.

## Deliverables
Generate the Supabase SQL migration script first (tables, constraints, indexes, RLS, storage policies, bucket limits), followed by the Expo Router file structure and the code for the core React Native components: `_layout.tsx`, `sign-in.tsx`, `index.tsx`, `trip/new.tsx`, `trip/[id]/edit.tsx`, `trip/[id].tsx`, `trip/[id]/gallery.tsx`, `components/CameraViewfinder.tsx`, and the offline queue utility, all styled from `theme.ts`.
