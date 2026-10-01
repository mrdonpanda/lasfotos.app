-- Notes on trips and cars. Idempotent. Existing RLS policies already cover new columns
-- (they are row-level, keyed on user_id), so no policy changes are needed.

alter table public.trips add column if not exists notes text;
alter table public.cars  add column if not exists notes text;

-- Guard rails: a stuck keyboard or a paste cannot store a huge note.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trips_notes_len') then
    alter table public.trips add constraint trips_notes_len
      check (notes is null or char_length(notes) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cars_notes_len') then
    alter table public.cars add constraint cars_notes_len
      check (notes is null or char_length(notes) <= 200);
  end if;
end $$;

comment on column public.trips.notes is 'Free-text trip note (max 2000 chars).';
comment on column public.cars.notes  is 'Short lot note, e.g. "No keys" (max 200 chars). Sent in the first WhatsApp caption.';
