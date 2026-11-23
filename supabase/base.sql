-- UNDERGROUND — base schema: the three tables that were created in the Supabase dashboard before any
-- SQL file existed (articles, categories, admin_users) and their original policies.
--
-- This is the exact, exported definition. It was captured read-only from production project
-- lhhmzfwjznlwkentbakv on 2026-11-23 — columns, constraints, indexes, the RLS flag and every policy —
-- so a rebuilt database now gets the real thing instead of a guess. The export query is in
-- docs/DATABASE.md, section 7. No data rows and no secrets are included.
--
-- Run this file FIRST on a fresh project, before every other file in this folder: community.sql and
-- security.sql depend on these tables, and security.sql layers the 2FA rules for articles and
-- categories on top of the permissive rules created here. Safe to re-run (create ... if not exists,
-- drop policy if exists, create policy).
--
-- Note: the admin write rules below check admin_users directly, exactly as they were created in the
-- dashboard. That is what makes them safe to create before ug_is_admin() exists. New rules should
-- prefer ug_is_admin() instead (see docs/DATABASE.md, section 6).

-- ---------------------------------------------------------------------------
-- admin_users — who may use the admin panel. Written only by the owner in the
-- dashboard or with the service key; the browser can read only its own row.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
drop policy if exists "Admins can read own admin record" on public.admin_users;
create policy "Admins can read own admin record" on public.admin_users
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- categories — public list, editable only by admins.
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;

drop policy if exists "Categories are publicly readable" on public.categories;
create policy "Categories are publicly readable" on public.categories
  for select to anon, authenticated using (true);
drop policy if exists "Admins can insert categories" on public.categories;
create policy "Admins can insert categories" on public.categories
  for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Admins can update categories" on public.categories;
create policy "Admins can update categories" on public.categories
  for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Admins can delete categories" on public.categories;
create policy "Admins can delete categories" on public.categories
  for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- articles — the magazine. Anyone reads published stories; only admins write.
-- ---------------------------------------------------------------------------
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete set null,
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null default '',
  cover_image_url text,
  band_name text,
  album_name text,
  genre text,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  author_id uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text check (kind is null or kind in ('Review', 'News', 'Feature', 'Interview')),
  score numeric(3,1) check (score is null or (score >= 0 and score <= 10)),
  youtube_video_id text check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint published_requires_timestamp check (status <> 'published' or published_at is not null)
);
create index if not exists articles_author_id_idx on public.articles (author_id);
create index if not exists articles_category_id_idx on public.articles (category_id);
create index if not exists articles_status_published_at_idx on public.articles (status, published_at desc);
create index if not exists articles_tags_idx on public.articles using gin (tags);
alter table public.articles enable row level security;

drop policy if exists "Published articles are publicly readable" on public.articles;
create policy "Published articles are publicly readable" on public.articles
  for select to anon, authenticated using (status = 'published');
-- "Admins can read all articles" is the policy added in the dashboard on 2026-11-17 to fix the
-- INSERT ... RETURNING failure (docs/DATABASE.md, section 6). Without it, an admin can insert a
-- draft but not read it back. The restrictive 2FA policy in security.sql still applies on top.
drop policy if exists "Admins can read all articles" on public.articles;
create policy "Admins can read all articles" on public.articles
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Admins can create articles" on public.articles;
create policy "Admins can create articles" on public.articles
  for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Admins can update articles" on public.articles;
create policy "Admins can update articles" on public.articles
  for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Admins can delete articles" on public.articles;
create policy "Admins can delete articles" on public.articles
  for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Privileges. Supabase grants ALL on a new table to anon, authenticated and service_role by default,
-- which includes TRUNCATE, REFERENCES and TRIGGER. The site never uses those (the API exposes only
-- select / insert / update / delete) and TRUNCATE is not filtered by RLS, so drop them from the
-- client roles. Rows stay governed by the policies above; service_role bypasses RLS by design.
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on public.articles, public.categories, public.admin_users
  from anon, authenticated;

notify pgrst, 'reload schema';
