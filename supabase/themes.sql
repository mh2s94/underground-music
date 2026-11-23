-- UNDERGROUND — Theme Manager (Tahap 2). Run ONCE in Supabase → SQL Editor. Safe to re-run.
-- Requires security.sql (public.ug_is_admin(), which means "listed in admin_users AND the session
-- passed two-step verification (aal2)").
--
-- What it creates
--   site_theme_active   one row: the theme every visitor gets (theme id + validated tokens + version)
--   site_theme_configs  saved theme configurations / drafts (admins only)
--   site_theme_history  a copy of every Apply / Restore / Reset, for rollback (admins only)
--   ug_clean_theme_tokens(jsonb)  token validator — mirrors assets/theme/schema.js exactly
--   ug_active_theme()             public read of the active theme (only id, tokens, version)
--   ug_apply_theme(...)           Apply (admins with 2FA only), atomic, writes history
--   ug_restore_theme(id)          Restore a history entry (admins with 2FA only)
--   ug_reset_theme()              Back to the permanent default theme "monochrome-modular" (admins with 2FA only)
--
-- Security model
--   * RLS is on for all three tables. Visitors have NO table access at all (privileges revoked);
--     they read the active theme only through ug_active_theme(), which returns three safe fields
--     (no admin id, no config id, no timestamps).
--   * Signed-in non-admins pass no policy, so they see and change nothing.
--   * Admins (ug_is_admin(), so 2FA is required) may manage configs and read history/active state,
--     but can NOT write site_theme_active or site_theme_history directly: there are no write
--     privileges or policies on them. Every change goes through the SECURITY DEFINER functions,
--     which check ug_is_admin() first, validate the theme id and tokens, and run in one transaction.
--   * SECURITY DEFINER functions use an empty search_path and fully qualified names, so they cannot
--     be hijacked by objects created in another schema. They run as the role that runs this file
--     (in Supabase: postgres, the owner of the tables), which is what lets the wrappers call the
--     internal ug_theme_write() even though no client role may execute it.
--   * service_role (the server key) gets no table access and cannot call the write functions: no
--     server code needs it, so a leaked key cannot change or read theme data. It may still call
--     ug_active_theme() like anyone else.
--   * The stored tokens can only ever be clean: CHECK constraints reject any row whose tokens differ
--     from ug_clean_theme_tokens(tokens), even for writes made by hand in the dashboard, and
--     ug_active_theme() cleans again on the way out.
--   * Tokens are validated in the database (here), again at the edge and again in the browser, by
--     the same rules. Unknown keys and bad values are dropped, never stored.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Token validator. Keep in sync with TOKENS and FONTS in assets/theme/schema.js.
--    Input: any jsonb. Output: a jsonb object with only valid keys and normalised values.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ug_clean_theme_tokens(p_tokens jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  colour_keys constant text[] := array['accent','accentHi','accentTint','onAccent','accent2','accent2Hi',
    'accent2Tint','void','bg','shell','surface','surface2','surface3','line','line2','ink','inkSoft',
    'muted','faint','ok','warn'];
  font_keys constant text[] := array['fontDisplay','fontBody','fontMono'];
  fonts constant text[] := array['bebas-neue','anton','inter','space-mono','fraunces','archivo-black',
    'inter-tight','space-grotesk','big-shoulders','special-elite','system','serif','mono'];
  clean jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  s text;
  n numeric;
begin
  if p_tokens is null or pg_catalog.jsonb_typeof(p_tokens) <> 'object' then
    return clean;
  end if;
  for k, v in select * from pg_catalog.jsonb_each(p_tokens) loop
    if k = any (colour_keys) then
      -- "#RRGGBB" exactly (no trimming), stored upper-case
      if pg_catalog.jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^#[0-9A-Fa-f]{6}$' then
        clean := clean || pg_catalog.jsonb_build_object(k, pg_catalog.upper(v #>> '{}'));
      end if;
    elsif k = any (font_keys) then
      if pg_catalog.jsonb_typeof(v) = 'string' and (v #>> '{}') = any (fonts) then
        clean := clean || pg_catalog.jsonb_build_object(k, v #>> '{}');
      end if;
    elsif k in ('radius', 'scanlines') then
      -- A JSON number, or a numeric string, with at most 6 integer digits and 2 decimals.
      -- Clamped, never rounded (rounding differs between JavaScript and PostgreSQL).
      n := null;
      if pg_catalog.jsonb_typeof(v) = 'number' then
        n := pg_catalog.trim_scale((v #>> '{}')::numeric);
        if pg_catalog.scale(n) > 2 or pg_catalog.abs(n) >= 1000000 then n := null; end if;
      elsif pg_catalog.jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]{1,6}([.][0-9]{1,2})?$' then
        n := pg_catalog.trim_scale((v #>> '{}')::numeric);
      end if;
      if n is not null then
        if k = 'radius' then n := least(32, greatest(0, n)); else n := least(1, greatest(0, n)); end if;
        clean := clean || pg_catalog.jsonb_build_object(k, pg_catalog.trim_scale(n));
      end if;
    end if;
  end loop;
  return clean;
end
$$;
revoke all on function public.ug_clean_theme_tokens(jsonb) from public, anon, service_role;
grant execute on function public.ug_clean_theme_tokens(jsonb) to authenticated;

-- Theme ids in the catalogue (assets/theme/schema.js THEMES). Whether a theme is "ready" is
-- decided by the code; the edge and the browser fall back to monochrome-modular for any theme that is not.
create or replace function public.ug_theme_id_ok(p_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_id = 'monochrome-modular';
$$;
revoke all on function public.ug_theme_id_ok(text) from public, anon, service_role;
grant execute on function public.ug_theme_id_ok(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.site_theme_configs (
  id          uuid primary key default gen_random_uuid(),
  theme_id    text not null check (public.ug_theme_id_ok(theme_id)),
  name        text not null default '' check (char_length(name) <= 80),
  tokens      jsonb not null default '{}'::jsonb,
  note        text not null default '' check (char_length(note) <= 500),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.site_theme_active (
  id          smallint primary key default 1 check (id = 1),
  theme_id    text not null default 'monochrome-modular' check (public.ug_theme_id_ok(theme_id)),
  tokens      jsonb not null default '{}'::jsonb,
  version     bigint not null default 1 check (version > 0),
  config_id   uuid references public.site_theme_configs(id) on delete set null,
  applied_by  uuid,
  applied_at  timestamptz not null default now()
);
alter table public.site_theme_active alter column theme_id set default 'monochrome-modular';
insert into public.site_theme_active (id) values (1) on conflict (id) do nothing;

create table if not exists public.site_theme_history (
  id          bigint generated always as identity primary key,
  action      text not null check (action in ('apply', 'restore', 'reset')),
  theme_id    text not null check (public.ug_theme_id_ok(theme_id)),
  tokens      jsonb not null,
  version     bigint not null,
  config_id   uuid references public.site_theme_configs(id) on delete set null,
  applied_by  uuid,
  applied_at  timestamptz not null default now(),
  note        text not null default '' check (char_length(note) <= 200)
);
create index if not exists site_theme_history_applied_at on public.site_theme_history (applied_at desc);

-- Stored tokens must always be exactly what the validator returns (added by name, so a re-run
-- does not duplicate them).
do $$
declare t text;
begin
  foreach t in array array['site_theme_configs', 'site_theme_active', 'site_theme_history'] loop
    if not exists (select 1 from pg_catalog.pg_constraint
                    where conname = t || '_tokens_clean' and conrelid = ('public.' || t)::regclass) then
      execute pg_catalog.format(
        'alter table public.%I add constraint %I check (tokens = public.ug_clean_theme_tokens(tokens))',
        t, t || '_tokens_clean');
    end if;
  end loop;
end $$;

-- Saved configs always hold validated tokens, whoever writes them.
create or replace function public.ug_theme_config_clean()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tokens := public.ug_clean_theme_tokens(new.tokens);
  new.updated_at := pg_catalog.now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end
$$;
revoke all on function public.ug_theme_config_clean() from public, anon, authenticated, service_role;
drop trigger if exists ug_theme_config_clean on public.site_theme_configs;
create trigger ug_theme_config_clean before insert or update on public.site_theme_configs
  for each row execute function public.ug_theme_config_clean();

-- ---------------------------------------------------------------------------------------------
-- 3. Privileges + RLS
-- ---------------------------------------------------------------------------------------------
alter table public.site_theme_configs enable row level security;
alter table public.site_theme_active  enable row level security;
alter table public.site_theme_history enable row level security;

-- Visitors and the server key: no direct table access at all (visitors use ug_active_theme()).
revoke all on public.site_theme_configs, public.site_theme_active, public.site_theme_history from public, anon, service_role;
revoke all on sequence public.site_theme_history_id_seq from public, anon, authenticated, service_role;
-- Signed-in users: configs can be managed (policies below allow admins only);
-- active/history are read-only (admins only), written only by the functions.
revoke all on public.site_theme_configs, public.site_theme_active, public.site_theme_history from authenticated;
grant select, insert, update, delete on public.site_theme_configs to authenticated;
grant select on public.site_theme_active, public.site_theme_history to authenticated;

drop policy if exists "Admins manage theme configs" on public.site_theme_configs;
create policy "Admins manage theme configs" on public.site_theme_configs
  for all to authenticated
  using (public.ug_is_admin()) with check (public.ug_is_admin());

drop policy if exists "Admins read the active theme row" on public.site_theme_active;
create policy "Admins read the active theme row" on public.site_theme_active
  for select to authenticated using (public.ug_is_admin());

drop policy if exists "Admins read theme history" on public.site_theme_history;
create policy "Admins read theme history" on public.site_theme_history
  for select to authenticated using (public.ug_is_admin());

-- ---------------------------------------------------------------------------------------------
-- 4. Public read: the active theme, three safe fields only
-- ---------------------------------------------------------------------------------------------
create or replace function public.ug_active_theme()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select pg_catalog.jsonb_build_object(
              'theme',   case when public.ug_theme_id_ok(a.theme_id) then a.theme_id else 'monochrome-modular' end,
              'tokens',  public.ug_clean_theme_tokens(a.tokens),
              'version', a.version)
       from public.site_theme_active a where a.id = 1),
    '{"theme":"monochrome-modular","tokens":{},"version":0}'::jsonb);
$$;
revoke all on function public.ug_active_theme() from public;
grant execute on function public.ug_active_theme() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Apply / Restore / Reset (admins with 2FA only)
-- ---------------------------------------------------------------------------------------------
-- Internal: writes the active row and a history entry in the caller's transaction.
-- Not executable by anyone directly; only the three wrappers below call it.
create or replace function public.ug_theme_write(p_action text, p_theme_id text, p_tokens jsonb,
  p_config_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean jsonb;
  v_version bigint;
begin
  if not public.ug_is_admin() then
    raise exception 'Not allowed: admin with two-step verification required' using errcode = '42501';
  end if;
  if p_theme_id is null or not public.ug_theme_id_ok(p_theme_id) then
    raise exception 'Unknown theme' using errcode = '22023';
  end if;
  if p_config_id is not null and not exists (select 1 from public.site_theme_configs c where c.id = p_config_id) then
    p_config_id := null;
  end if;
  v_clean := public.ug_clean_theme_tokens(p_tokens);

  -- One atomic statement, so parallel applies queue on the row lock and each gets its own version,
  -- also when the row was removed by hand (then the first one recreates it at version 1).
  insert into public.site_theme_active as a (id, theme_id, tokens, version, config_id, applied_by, applied_at)
  values (1, p_theme_id, v_clean, 1, p_config_id, auth.uid(), pg_catalog.now())
  on conflict (id) do update
     set theme_id = excluded.theme_id, tokens = excluded.tokens, version = a.version + 1,
         config_id = excluded.config_id, applied_by = excluded.applied_by, applied_at = excluded.applied_at
  returning a.version into v_version;

  insert into public.site_theme_history (action, theme_id, tokens, version, config_id, applied_by, note)
  values (p_action, p_theme_id, v_clean, v_version, p_config_id, auth.uid(), pg_catalog.left(coalesce(p_note, ''), 200));

  return pg_catalog.jsonb_build_object('theme', p_theme_id, 'tokens', v_clean, 'version', v_version);
end
$$;
revoke all on function public.ug_theme_write(text, text, jsonb, uuid, text) from public, anon, authenticated, service_role;

create or replace function public.ug_apply_theme(p_theme_id text, p_tokens jsonb default '{}'::jsonb,
  p_config_id uuid default null, p_note text default '')
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.ug_theme_write('apply', p_theme_id, p_tokens, p_config_id, p_note);
$$;

create or replace function public.ug_restore_theme(p_history_id bigint, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare h public.site_theme_history;
begin
  if not public.ug_is_admin() then
    raise exception 'Not allowed: admin with two-step verification required' using errcode = '42501';
  end if;
  select * into h from public.site_theme_history where id = p_history_id;
  if not found then raise exception 'History entry not found' using errcode = '22023'; end if;
  return public.ug_theme_write('restore', h.theme_id, h.tokens, h.config_id,
    coalesce(nullif(p_note, ''), 'Restore of version ' || h.version));
end
$$;

create or replace function public.ug_reset_theme(p_note text default '')
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.ug_theme_write('reset', 'monochrome-modular', '{}'::jsonb, null, coalesce(nullif(p_note, ''), 'Reset to default'));
$$;

revoke all on function public.ug_apply_theme(text, jsonb, uuid, text) from public, anon, service_role;
revoke all on function public.ug_restore_theme(bigint, text) from public, anon, service_role;
revoke all on function public.ug_reset_theme(text) from public, anon, service_role;
grant execute on function public.ug_apply_theme(text, jsonb, uuid, text) to authenticated;
grant execute on function public.ug_restore_theme(bigint, text) to authenticated;
grant execute on function public.ug_reset_theme(text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------------------
-- Verification (run after the migration; read-only)
-- ---------------------------------------------------------------------------------------------
-- 1. RLS on:        select relname, relrowsecurity from pg_class where relname like 'site_theme_%';
-- 2. Public read:   select public.ug_active_theme();      -- {"theme":"monochrome-modular","tokens":{},"version":1}
-- 3. Policies:      select tablename, policyname, cmd, roles from pg_policies where tablename like 'site_theme_%';
-- 4. Grants:        select table_name, grantee, privilege_type from information_schema.role_table_grants
--                   where table_name like 'site_theme_%' and grantee in ('anon','authenticated','service_role') order by 1,2,3;
--                   -- expected: nothing for anon and service_role; authenticated: SELECT on
--                   -- site_theme_active and site_theme_history, DELETE/INSERT/SELECT/UPDATE on site_theme_configs
-- 5. Functions:     select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig,
--                          has_function_privilege('anon', p.oid, 'execute') as anon,
--                          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--                          has_function_privilege('service_role', p.oid, 'execute') as service_role
--                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                   where n.nspname = 'public' and p.proname like 'ug_%theme%' order by 1;
--                   -- owner = the owner of the site_theme_* tables (postgres); every SECURITY DEFINER
--                   -- function has search_path=""; anon may execute only ug_active_theme;
--                   -- nobody may execute ug_theme_write or ug_theme_config_clean
