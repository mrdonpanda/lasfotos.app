-- lasfotos.app: trips -> cars -> photos, RLS, and private `fotos` bucket policies.
-- Idempotent: safe to re-run.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table if not exists public.trips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  location_name text not null check (length(btrim(location_name)) > 0),
  trip_date     date not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.cars (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lot_number  text check (lot_number is null or lot_number ~ '^[A-Za-z0-9_.-]+$'),
  position    integer not null check (position > 0),
  created_at  timestamptz not null default now(),
  constraint cars_trip_position_key unique (trip_id, position)
);

-- Lot numbers appear in storage file names, so they must be unique per trip.
create unique index if not exists cars_trip_lot_number_key
  on public.cars (trip_id, lot_number)
  where lot_number is not null;

create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  car_id       uuid not null references public.cars (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  angle        text not null check (angle in
                 ('top','front','driver_side','back','passenger_side','keys','under_vehicle')),
  storage_path text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint photos_car_angle_key unique (car_id, angle)
);

create index if not exists trips_user_date_idx on public.trips (user_id, trip_date desc);
create index if not exists cars_trip_idx       on public.cars (trip_id);
create index if not exists cars_user_idx       on public.cars (user_id);
create index if not exists photos_car_idx      on public.photos (car_id);
create index if not exists photos_user_idx     on public.photos (user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists photos_touch_updated_at on public.photos;
create trigger photos_touch_updated_at
  before update on public.photos
  for each row execute function public.touch_updated_at();

------------------------------------------------------------------------------
-- Table privileges: signed-in users only; anon gets nothing.
------------------------------------------------------------------------------

revoke all on public.trips, public.cars, public.photos from anon;
grant select, insert, update, delete on public.trips, public.cars, public.photos to authenticated;

------------------------------------------------------------------------------
-- Row Level Security
------------------------------------------------------------------------------

alter table public.trips  enable row level security;
alter table public.cars   enable row level security;
alter table public.photos enable row level security;

-- trips ----------------------------------------------------------------------
drop policy if exists trips_select on public.trips;
drop policy if exists trips_insert on public.trips;
drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;

create policy trips_select on public.trips for select to authenticated
  using ((select auth.uid()) = user_id);
create policy trips_insert on public.trips for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy trips_update on public.trips for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy trips_delete on public.trips for delete to authenticated
  using ((select auth.uid()) = user_id);

-- cars (parent trip must belong to the caller) -------------------------------
drop policy if exists cars_select on public.cars;
drop policy if exists cars_insert on public.cars;
drop policy if exists cars_update on public.cars;
drop policy if exists cars_delete on public.cars;

create policy cars_select on public.cars for select to authenticated
  using ((select auth.uid()) = user_id);
create policy cars_insert on public.cars for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.trips t where t.id = trip_id and t.user_id = (select auth.uid()))
  );
create policy cars_update on public.cars for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.trips t where t.id = trip_id and t.user_id = (select auth.uid()))
  );
create policy cars_delete on public.cars for delete to authenticated
  using ((select auth.uid()) = user_id);

-- photos (parent car must belong to the caller) ------------------------------
drop policy if exists photos_select on public.photos;
drop policy if exists photos_insert on public.photos;
drop policy if exists photos_update on public.photos;
drop policy if exists photos_delete on public.photos;

create policy photos_select on public.photos for select to authenticated
  using ((select auth.uid()) = user_id);
create policy photos_insert on public.photos for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.cars c where c.id = car_id and c.user_id = (select auth.uid()))
  );
create policy photos_update on public.photos for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.cars c where c.id = car_id and c.user_id = (select auth.uid()))
  );
create policy photos_delete on public.photos for delete to authenticated
  using ((select auth.uid()) = user_id);

------------------------------------------------------------------------------
-- Storage: private `fotos` bucket, objects live under {user_id}/{trip_id}/...
------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg'];

drop policy if exists fotos_select on storage.objects;
drop policy if exists fotos_insert on storage.objects;
drop policy if exists fotos_update on storage.objects;
drop policy if exists fotos_delete on storage.objects;

-- upsert needs INSERT + SELECT + UPDATE; storage.move needs UPDATE.
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
