-- UNDERGROUND · Basement Radio · non-destructive trim (music v3)
-- Run once in the Supabase SQL Editor AFTER the owner has reviewed it. Safe to run again.
-- Only ADDS columns and constraints. audio_path / audio_url and the audio files are never touched.
-- RLS is unchanged: the existing admin update policy (ug_is_admin(), 2FA) already covers these columns.
-- The site and admin work before this runs (songs play in full and trims are not saved).

begin;

alter table public.tracks
  add column if not exists trim_start_ms integer,
  add column if not exists trim_end_ms   integer,
  add column if not exists allow_full    boolean not null default true,
  add column if not exists waveform      jsonb;

comment on column public.tracks.trim_start_ms is 'Playback start (ms). NULL = from the start of the file.';
comment on column public.tracks.trim_end_ms   is 'Playback end (ms). NULL = to the end of the file.';
comment on column public.tracks.allow_full    is 'Listeners may switch from the cut to the full song.';
comment on column public.tracks.waveform      is 'Waveform peaks for the admin trim editor (array of 0-255).';

do $$ begin
  alter table public.tracks add constraint tracks_trim_start_range
    check (trim_start_ms is null or trim_start_ms between 0 and 7200000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tracks add constraint tracks_trim_end_range
    check (trim_end_ms is null or trim_end_ms between 1000 and 7200000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tracks add constraint tracks_trim_order
    check (trim_start_ms is null or trim_end_ms is null or trim_end_ms - trim_start_ms >= 1000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tracks add constraint tracks_trim_within_duration
    check (duration_sec is null
           or ((trim_start_ms is null or trim_start_ms < duration_sec * 1000)
           and (trim_end_ms   is null or trim_end_ms  <= duration_sec * 1000 + 1000)));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tracks add constraint tracks_waveform_shape
    check (waveform is null or (jsonb_typeof(waveform) = 'array' and jsonb_array_length(waveform) <= 2000));
exception when duplicate_object then null; end $$;

-- Community chart also returns the trim, so songs played from the chart are cut too.
-- The return type changes, so the function is dropped and created again. The query is the same
-- as supabase/charts.sql with three extra columns at the end.
drop function if exists public.ug_chart_tracks(text, integer, text[]);

create function public.ug_chart_tracks(p_period text default 'all', p_limit integer default 10, p_genres text[] default null)
returns table (id uuid, title text, artist text, genre text, album text, cover_url text, audio_url text,
               duration_sec integer, avg_stars numeric, votes integer, score numeric,
               trim_start_ms integer, trim_end_ms integer, allow_full boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select tr.track_id, tr.stars from public.track_ratings tr
    join public.tracks t on t.id = tr.track_id and t.status = 'published'
    where (p_period is distinct from 'week' or tr.updated_at > now() - interval '7 days')
      and (p_genres is null or lower(coalesce(t.genre, 'underground')) = any (select lower(x) from unnest(p_genres) x))
  ),
  g as (select coalesce(avg(stars), 3.5) as m from r),
  a as (select track_id, avg(stars) as av, count(*) as n, sum(stars) as s from r group by track_id)
  select t.id, t.title, t.artist, t.genre, t.album, t.cover_url, t.audio_url, t.duration_sec,
         round(a.av, 2), a.n::int, round((a.s + 3 * g.m) / (a.n + 3), 4),
         t.trim_start_ms, t.trim_end_ms, t.allow_full
  from a join public.tracks t on t.id = a.track_id cross join g
  order by 11 desc, a.n desc, t.published_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke all on function public.ug_chart_tracks(text, integer, text[]) from public;
grant execute on function public.ug_chart_tracks(text, integer, text[]) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- Rollback (only if ever needed; audio files are not affected):
--   1. run the ug_chart_tracks part of supabase/charts.sql again (drop function first)
--   2. alter table public.tracks drop column if exists waveform, drop column if exists allow_full,
--        drop column if exists trim_end_ms, drop column if exists trim_start_ms;
