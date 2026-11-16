-- UNDERGROUND — visitor accounts: profiles, saved articles, comments, demo submissions.
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Helper: is the current user an administrator?
-- ---------------------------------------------------------------------------
create or replace function public.ug_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.ug_is_admin() from public;
grant execute on function public.ug_is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user, created automatically on sign-up)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  favorite_genres text[] not null default '{}' check (cardinality(favorite_genres) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);
drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.ug_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  name text := left(btrim(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))), 40);
begin
  if char_length(name) < 2 then name := 'Reader'; end if;
  insert into public.profiles (id, display_name) values (new.id, name) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists ug_on_auth_user_created on auth.users;
create trigger ug_on_auth_user_created after insert on auth.users
  for each row execute function public.ug_handle_new_user();

-- Profiles for accounts that existed before this script
insert into public.profiles (id, display_name)
select u.id, greatest_name.name
from auth.users u
cross join lateral (
  select case when char_length(n) >= 2 then n else 'Reader' end as name
  from (select left(btrim(coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), split_part(u.email, '@', 1))), 40) as n) s
) greatest_name
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Saved articles and comments (article_id matches the type of articles.id)
-- ---------------------------------------------------------------------------
do $$
declare
  id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_attribute a
  where a.attrelid = 'public.articles'::regclass and a.attname = 'id';

  execute format($f$
    create table if not exists public.saved_articles (
      user_id uuid not null references public.profiles (id) on delete cascade,
      article_id %s not null references public.articles (id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (user_id, article_id)
    )$f$, id_type);

  execute format($f$
    create table if not exists public.comments (
      id uuid primary key default gen_random_uuid(),
      article_id %s not null references public.articles (id) on delete cascade,
      user_id uuid not null references public.profiles (id) on delete cascade,
      body text not null check (char_length(btrim(body)) between 1 and 2000),
      created_at timestamptz not null default now()
    )$f$, id_type);
end;
$$;
create index if not exists comments_article_idx on public.comments (article_id, created_at);

alter table public.saved_articles enable row level security;
drop policy if exists "Users read own saves" on public.saved_articles;
create policy "Users read own saves" on public.saved_articles for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users save published articles" on public.saved_articles;
create policy "Users save published articles" on public.saved_articles for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.articles a where a.id = article_id and a.status = 'published'));
drop policy if exists "Users remove own saves" on public.saved_articles;
create policy "Users remove own saves" on public.saved_articles for delete to authenticated using (user_id = auth.uid());

alter table public.comments enable row level security;
drop policy if exists "Comments on published articles are public" on public.comments;
create policy "Comments on published articles are public" on public.comments for select
  using (exists (select 1 from public.articles a where a.id = article_id and a.status = 'published') or user_id = auth.uid() or public.ug_is_admin());
drop policy if exists "Members comment on published articles" on public.comments;
create policy "Members comment on published articles" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.articles a where a.id = article_id and a.status = 'published'));
drop policy if exists "Authors and admins delete comments" on public.comments;
create policy "Authors and admins delete comments" on public.comments for delete to authenticated
  using (user_id = auth.uid() or public.ug_is_admin());

-- Simple anti-spam: at most 5 comments per minute per member
create or replace function public.ug_comment_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.comments where user_id = new.user_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'You are commenting too fast. Please wait a minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists ug_comment_rate_limit on public.comments;
create trigger ug_comment_rate_limit before insert on public.comments
  for each row execute function public.ug_comment_rate_limit();

-- ---------------------------------------------------------------------------
-- Demo submissions
-- ---------------------------------------------------------------------------
create table if not exists public.demo_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  band_name text not null check (char_length(btrim(band_name)) between 1 and 120),
  country text check (country is null or char_length(country) <= 80),
  genre text check (genre is null or char_length(genre) <= 40),
  link text not null check (char_length(link) <= 500 and link ~* '^https://[^[:space:]]+\.[^[:space:]]+$'),
  message text check (message is null or char_length(message) <= 1500),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status text not null default 'new' check (status in ('new', 'listened', 'featured', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists demo_submissions_created_idx on public.demo_submissions (created_at desc);
alter table public.demo_submissions enable row level security;

drop policy if exists "Members submit demos" on public.demo_submissions;
create policy "Members submit demos" on public.demo_submissions for insert to authenticated
  with check (user_id = auth.uid() and status = 'new');
drop policy if exists "Members see own demos, admins see all" on public.demo_submissions;
create policy "Members see own demos, admins see all" on public.demo_submissions for select to authenticated
  using (user_id = auth.uid() or public.ug_is_admin());
drop policy if exists "Admins update demos" on public.demo_submissions;
create policy "Admins update demos" on public.demo_submissions for update to authenticated
  using (public.ug_is_admin()) with check (public.ug_is_admin());
drop policy if exists "Admins delete demos" on public.demo_submissions;
create policy "Admins delete demos" on public.demo_submissions for delete to authenticated
  using (public.ug_is_admin());

-- At most 3 demo submissions per member per day
create or replace function public.ug_demo_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.demo_submissions where user_id = new.user_id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You can send up to 3 demos per day.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists ug_demo_rate_limit on public.demo_submissions;
create trigger ug_demo_rate_limit before insert on public.demo_submissions
  for each row execute function public.ug_demo_rate_limit();

-- Let admins read admin_users membership of themselves (used to show admin tools)
-- (admin.html already relies on this; no change if your existing policy allows it.)
