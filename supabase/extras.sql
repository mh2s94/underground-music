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
