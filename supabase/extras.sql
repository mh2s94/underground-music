-- UNDERGROUND — review scores, band profiles and newsletter sign-ups.
-- Run once in Supabase Dashboard → SQL Editor (after community.sql, music.sql, charts.sql). Safe to re-run.

-- ---------------------------------------------------------------------------
-- Articles: type (Review / News / Feature / Interview) and review score 0–10
-- ---------------------------------------------------------------------------
alter table public.articles add column if not exists kind text;
alter table public.articles add column if not exists score numeric(3,1);
do $$ begin
  alter table public.articles add constraint articles_kind_check check (kind is null or kind in ('Review', 'News', 'Feature', 'Interview'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.articles add constraint articles_score_check check (score is null or (score >= 0 and score <= 10));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Band profile: members' star rating across all of a band's songs
-- (artist names match case-insensitively; "-" in the address matches a space)
-- ---------------------------------------------------------------------------
create or replace function public.ug_band_rating(p_artist text)
returns table (avg_stars numeric, votes integer, rated_tracks integer)
language sql stable security definer set search_path = public as $$
  select round(avg(r.stars), 2), count(*)::int, count(distinct r.track_id)::int
  from public.track_ratings r
  join public.tracks t on t.id = r.track_id and t.status = 'published'
  where lower(regexp_replace(btrim(t.artist), '[^[:alnum:]]+', '-', 'g')) = lower(regexp_replace(btrim(p_artist), '[^[:alnum:]]+', '-', 'g'));
$$;
revoke all on function public.ug_band_rating(text) from public;
grant execute on function public.ug_band_rating(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Newsletter: anyone can subscribe; only admins can read or remove the list
-- ---------------------------------------------------------------------------
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 6 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source text check (source is null or char_length(source) <= 40),
  created_at timestamptz not null default now()
);
create unique index if not exists newsletter_email_key on public.newsletter_subscribers (lower(email));
alter table public.newsletter_subscribers enable row level security;
drop policy if exists "Admins read subscribers" on public.newsletter_subscribers;
create policy "Admins read subscribers" on public.newsletter_subscribers for select to authenticated using (public.ug_is_admin());
drop policy if exists "Admins remove subscribers" on public.newsletter_subscribers;
create policy "Admins remove subscribers" on public.newsletter_subscribers for delete to authenticated using (public.ug_is_admin());
grant select, delete on public.newsletter_subscribers to authenticated;

-- Sign-up goes through this function, so the list itself is never readable by visitors.
-- It answers the same way for new and existing addresses (no way to probe who is subscribed).
create or replace function public.ug_subscribe(p_email text, p_source text default 'site')
returns text
language plpgsql volatile security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(e) < 6 or char_length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  -- simple flood guard: at most 30 new sign-ups per minute site-wide
  if (select count(*) from public.newsletter_subscribers where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many sign-ups right now. Try again in a minute.' using errcode = '54000';
  end if;
  insert into public.newsletter_subscribers (email, source) values (e, left(coalesce(p_source, 'site'), 40))
  on conflict ((lower(email))) do nothing;
  return 'ok';
end $$;
revoke all on function public.ug_subscribe(text, text) from public;
grant execute on function public.ug_subscribe(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Part 2 (newsletter sending, account deletion, gigs). Safe to re-run.
-- ===========================================================================

-- Each subscriber gets a private token for the one-click unsubscribe link in emails
alter table public.newsletter_subscribers add column if not exists token uuid not null default gen_random_uuid();
create unique index if not exists newsletter_token_key on public.newsletter_subscribers (token);

create or replace function public.ug_unsubscribe(p_token uuid)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare e text;
begin
  delete from public.newsletter_subscribers where token = p_token returning email into e;
  return coalesce(e, '');
end $$;
revoke all on function public.ug_unsubscribe(uuid) from public;
grant execute on function public.ug_unsubscribe(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Members can delete their own account. Profile, comments, saves, ratings and
-- demo submissions are removed with it (foreign keys cascade).
-- ---------------------------------------------------------------------------
create or replace function public.ug_delete_my_account()
returns void
language plpgsql volatile security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if exists (select 1 from public.admin_users where user_id = uid) then
    raise exception 'Administrator accounts cannot be deleted here. Remove admin access first.' using errcode = '42501';
  end if;
  delete from public.newsletter_subscribers where lower(email) = lower((select email from auth.users where id = uid));
  delete from auth.users where id = uid;
end $$;
revoke all on function public.ug_delete_my_account() from public;
grant execute on function public.ug_delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Gigs / concert calendar
-- ---------------------------------------------------------------------------
create table if not exists public.gigs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  bands text[] not null default '{}' check (cardinality(bands) <= 20),
  venue text check (venue is null or char_length(venue) <= 160),
  city text check (city is null or char_length(city) <= 100),
  starts_at timestamptz not null,
  ticket_url text check (ticket_url is null or ticket_url ~* '^https?://'),
  poster_url text check (poster_url is null or poster_url ~* '^https://'),
  price text check (price is null or char_length(price) <= 60),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'published' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gigs_upcoming_idx on public.gigs (status, starts_at);
alter table public.gigs enable row level security;
drop policy if exists "Published gigs are public" on public.gigs;
create policy "Published gigs are public" on public.gigs for select using (status = 'published' or public.ug_is_admin());
drop policy if exists "Admins add gigs" on public.gigs;
create policy "Admins add gigs" on public.gigs for insert to authenticated with check (public.ug_is_admin());
drop policy if exists "Admins edit gigs" on public.gigs;
create policy "Admins edit gigs" on public.gigs for update to authenticated using (public.ug_is_admin()) with check (public.ug_is_admin());
drop policy if exists "Admins delete gigs" on public.gigs;
create policy "Admins delete gigs" on public.gigs for delete to authenticated using (public.ug_is_admin());
grant select on public.gigs to anon, authenticated;
grant insert, update, delete on public.gigs to authenticated;

-- Settings → Clean up data can now also clear gigs
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
      when 'gigs' then 'gigs'
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

notify pgrst, 'reload schema';
