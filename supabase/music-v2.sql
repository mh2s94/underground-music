-- UNDERGROUND — music update: adds album and release year to tracks.
-- Run once in Supabase Dashboard → SQL Editor (after music.sql). Safe to re-run.

alter table public.tracks add column if not exists album text;
alter table public.tracks add column if not exists release_year integer;

do $$ begin
  alter table public.tracks add constraint tracks_album_len check (album is null or char_length(album) <= 160);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tracks add constraint tracks_release_year_range check (release_year is null or release_year between 1900 and 2100);
exception when duplicate_object then null; end $$;

-- Cover images found online (iTunes / Deezer) are stored as https URLs — already allowed by cover_url's check.

notify pgrst, 'reload schema';
