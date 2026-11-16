-- UNDERGROUND — music library, audio storage and admin data cleanup.
-- Run once in Supabase Dashboard → SQL Editor (after community.sql). Safe to re-run.

-- Admin helper (same as in community.sql; repeated so this file also works on its own)
create or replace function public.ug_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'; -- admins must pass two-step verification (security.sql)
$$;
revoke all on function public.ug_is_admin() from public;
grant execute on function public.ug_is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tracks (separate from articles)
-- ---------------------------------------------------------------------------
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  artist text not null check (char_length(btrim(artist)) between 1 and 160),
  genre text check (genre is null or char_length(genre) <= 40),
  description text check (description is null or char_length(description) <= 1000),
  audio_path text not null check (char_length(audio_path) <= 300),
  audio_url text not null check (audio_url ~* '^https://'),
  cover_path text check (cover_path is null or char_length(cover_path) <= 300),
  cover_url text check (cover_url is null or cover_url ~* '^https://'),
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 7200),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tracks add column if not exists album text;
alter table public.tracks add column if not exists release_year integer;

create index if not exists tracks_published_idx on public.tracks (status, published_at desc);
alter table public.tracks enable row level security;

drop policy if exists "Published tracks are public" on public.tracks;
create policy "Published tracks are public" on public.tracks for select
  using (status = 'published' or public.ug_is_admin());
drop policy if exists "Admins add tracks" on public.tracks;
create policy "Admins add tracks" on public.tracks for insert to authenticated with check (public.ug_is_admin());
drop policy if exists "Admins edit tracks" on public.tracks;
create policy "Admins edit tracks" on public.tracks for update to authenticated using (public.ug_is_admin()) with check (public.ug_is_admin());
drop policy if exists "Admins delete tracks" on public.tracks;
create policy "Admins delete tracks" on public.tracks for delete to authenticated using (public.ug_is_admin());

-- ---------------------------------------------------------------------------
-- Storage bucket for audio files and covers (public read, admin write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music', 'music', true, 26214400,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac',
              'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "UG music files are public" on storage.objects;
create policy "UG music files are public" on storage.objects for select
  using (bucket_id = 'music');
drop policy if exists "UG admins upload music" on storage.objects;
create policy "UG admins upload music" on storage.objects for insert to authenticated
  with check (bucket_id = 'music' and public.ug_is_admin());
drop policy if exists "UG admins update music" on storage.objects;
create policy "UG admins update music" on storage.objects for update to authenticated
  using (bucket_id = 'music' and public.ug_is_admin()) with check (bucket_id = 'music' and public.ug_is_admin());
drop policy if exists "UG admins delete music" on storage.objects;
create policy "UG admins delete music" on storage.objects for delete to authenticated
  using (bucket_id = 'music' and public.ug_is_admin());

-- ---------------------------------------------------------------------------
-- Admin data cleanup. Targets: articles, comments, saved, tracks, demos.
-- Deleting articles also removes their comments and saves (foreign keys).
-- Audio/cover files are removed by the admin page through the Storage API.
-- Accounts, profiles, admin users and categories are never touched.
-- ---------------------------------------------------------------------------
create or replace function public.ug_admin_purge(p_targets text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  n integer;
  t text;
  tbl text;
begin
  if not public.ug_is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  foreach t in array coalesce(p_targets, '{}') loop
    tbl := case t
      when 'comments' then 'comments'
      when 'saved' then 'saved_articles'
      when 'articles' then 'articles'
      when 'tracks' then 'tracks'
      when 'demos' then 'demo_submissions'
      else null end;
    if tbl is null then
      raise exception 'Unknown cleanup target: %', t using errcode = '22023';
    end if;
    if to_regclass('public.' || tbl) is not null then
      execute format('delete from public.%I where true', tbl);
      get diagnostics n = row_count;
      result := result || jsonb_build_object(t, n);
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.ug_admin_purge(text[]) from public;
grant execute on function public.ug_admin_purge(text[]) to authenticated;
