# LasFotos (mobile app)

Android app for car-carrier drivers: create a trip, enter lot numbers, shoot seven angles per car, upload
offline-safely to Supabase. Spec: [`plan.md`](plan.md). Styling: [`theme.ts`](theme.ts). Photo capture, widest-lens
and volume-shutter code is adapted from the sibling app `tripTrack`.

## Setup

```bash
npm install          # postinstall patches expo-camera (ultrawide/zoom) and react-native-volume-manager
```

`.env` (git-ignored) needs the project URL and publishable key. Either naming works:

```
EXPO_PUBLIC_SUPABASE_URL=...      # or SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=... # or SUPABASE_PUBLISHABLE_KEY
```

`app.config.js` copies only those two values into the app. The secret key is never read by the app.

The camera and volume shutter need native code, so use a development or preview build, not Expo Go:

```bash
npx eas-cli build -p android --profile development
npx expo start --dev-client
```

## Database

`supabase/migrations/20260929170000_lasfotos_schema.sql` creates `trips`, `cars`, `photos`, RLS policies, and the
private `fotos` bucket policies. It is idempotent. Apply it with psql / the Supabase SQL path you use.

`node scripts/verify-backend.mjs` runs a live check of the schema, RLS isolation between two throwaway users, and
the private bucket (needs `SUPABASE_SECRET_KEY` in `.env`; it deletes its test users afterwards).

## Storage paths

`fotos/{user_id}/{trip_id}/{lot_number}_{angle_tag}.jpg`, tags: top, front, driver, back, passenger, keys, under.
Lot numbers are unique per trip, so paths cannot collide. Changing a lot number renames the stored files.
The bucket is private; the app uses signed URLs.

## Commands

```bash
npm run typecheck
npm test
```
