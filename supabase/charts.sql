-- UNDERGROUND — Charts: visitor star ratings for tracks + Top Bands / Top Hits rankings.
-- Run once in Supabase Dashboard → SQL Editor (after music.sql). Safe to re-run.

-- Columns used by the charts (also added by music-v2.sql)
alter table public.tracks add column if not exists album text;
alter table public.tracks add column if not exists release_year integer;

-- ---------------------------------------------------------------------------
-- One rating (1–5 stars) per member per track. Changing your vote updates it.
-- ---------------------------------------------------------------------------
create table if not exists public.track_ratings (
  track_id uuid not null references public.tracks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (track_id, user_id)
);
create index if not exists track_ratings_updated_idx on public.track_ratings (updated_at desc);
alter table public.track_ratings enable row level security;

-- Members only see and change their own votes; totals come from the functions below.
drop policy if exists "Members read own ratings" on public.track_ratings;
create policy "Members read own ratings" on public.track_ratings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Members rate published tracks" on public.track_ratings;
create policy "Members rate published tracks" on public.track_ratings
  for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.tracks t where t.id = track_id and t.status = 'published'));
drop policy if exists "Members change own ratings" on public.track_ratings;
create policy "Members change own ratings" on public.track_ratings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Members remove own ratings" on public.track_ratings;
create policy "Members remove own ratings" on public.track_ratings
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.track_ratings to authenticated;

-- ---------------------------------------------------------------------------
-- Rankings. p_genres: only tracks whose genre is in the list (null = every genre).
-- Score = Bayesian average: a track with one 5-star vote does not beat
-- a track with forty 4.8-star votes. p_period: 'week' (last 7 days) or 'all'.
-- ---------------------------------------------------------------------------
drop function if exists public.ug_chart_tracks(text, integer);
drop function if exists public.ug_chart_bands(text, integer);

create or replace function public.ug_chart_tracks(p_period text default 'all', p_limit integer default 10, p_genres text[] default null)
returns table (id uuid, title text, artist text, genre text, album text, cover_url text, audio_url text,
               duration_sec integer, avg_stars numeric, votes integer, score numeric)
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
         round(a.av, 2), a.n::int, round((a.s + 3 * g.m) / (a.n + 3), 4)
  from a join public.tracks t on t.id = a.track_id cross join g
  order by 11 desc, a.n desc, t.published_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

create or replace function public.ug_chart_bands(p_period text default 'all', p_limit integer default 10, p_genres text[] default null)
returns table (artist text, cover_url text, top_track text, tracks integer, avg_stars numeric, votes integer, score numeric)
language sql stable security definer set search_path = public as $$
  with r as (
    select tr.track_id, tr.stars from public.track_ratings tr
    join public.tracks t on t.id = tr.track_id and t.status = 'published'
    where (p_period is distinct from 'week' or tr.updated_at > now() - interval '7 days')
      and (p_genres is null or lower(coalesce(t.genre, 'underground')) = any (select lower(x) from unnest(p_genres) x))
  ),
  g as (select coalesce(avg(stars), 3.5) as m from r),
  a as (select track_id, avg(stars) as av, count(*) as n, sum(stars) as s from r group by track_id),
  j as (select t.*, a.av, a.n, a.s from a join public.tracks t on t.id = a.track_id)
  select min(j.artist),
         (array_agg(j.cover_url order by j.av desc, j.n desc) filter (where j.cover_url is not null))[1],
         (array_agg(j.title order by j.av desc, j.n desc))[1],
         count(*)::int,
         round(sum(j.s)::numeric / sum(j.n), 2),
         sum(j.n)::int,
         round((sum(j.s) + 3 * max(g.m)) / (sum(j.n) + 3), 4)
  from j cross join g
  group by lower(btrim(j.artist))
  order by 7 desc, 6 desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- Average + vote count for a single track (shown in the player)
create or replace function public.ug_track_rating(p_track uuid)
returns table (avg_stars numeric, votes integer)
language sql stable security definer set search_path = public as $$
  select round(avg(stars), 2), count(*)::int from public.track_ratings where track_id = p_track;
$$;

revoke all on function public.ug_chart_tracks(text, integer, text[]) from public;
revoke all on function public.ug_chart_bands(text, integer, text[]) from public;
revoke all on function public.ug_track_rating(uuid) from public;
grant execute on function public.ug_chart_tracks(text, integer, text[]) to anon, authenticated;
grant execute on function public.ug_chart_bands(text, integer, text[]) to anon, authenticated;
grant execute on function public.ug_track_rating(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
