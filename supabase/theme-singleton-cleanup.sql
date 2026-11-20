-- UNDERGROUND — one-time cleanup for the Monochrome Modular-only theme architecture.
-- Run in Supabase SQL Editor after deploying the matching application code.
-- Safe to re-run. Does not touch articles, users, or unrelated data.
begin;

-- Tighten the database allow-list as well as cleaning existing rows.
create or replace function public.ug_theme_id_ok(p_id text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_id = 'monochrome-modular';
$fn$;
revoke all on function public.ug_theme_id_ok(text) from public, anon, service_role;
grant execute on function public.ug_theme_id_ok(text) to authenticated;

alter table public.site_theme_active
  alter column theme_id set default 'monochrome-modular';

-- Ensure there is exactly one active row and that it points to the sole supported theme.
insert into public.site_theme_active (id, theme_id, tokens, version, config_id, applied_at)
values (1, 'monochrome-modular', '{}'::jsonb, 1, null, now())
on conflict (id) do update
set theme_id = 'monochrome-modular',
    tokens = '{}'::jsonb,
    version = public.site_theme_active.version + 1,
    config_id = null,
    applied_at = now();

-- Old configs are drafts, not required for runtime. Deleting them also nulls any remaining FK refs.
delete from public.site_theme_configs
where theme_id <> 'monochrome-modular';

-- Legacy history entries can no longer be restored under the single-theme policy.
delete from public.site_theme_history
where theme_id <> 'monochrome-modular';

-- Record the cleanup as the latest reset event.
insert into public.site_theme_history
  (action, theme_id, tokens, version, config_id, applied_by, note)
select 'reset', theme_id, tokens, version, null, null,
       'Cleanup: Monochrome Modular is the only supported theme'
from public.site_theme_active a
where a.id = 1
  and not exists (
    select 1 from public.site_theme_history h
    where h.action = 'reset'
      and h.theme_id = 'monochrome-modular'
      and h.note = 'Cleanup: Monochrome Modular is the only supported theme'
  );

commit;

notify pgrst, 'reload schema';

-- Verification
select id, theme_id, version, applied_at
from public.site_theme_active;

select theme_id, count(*) as rows
from public.site_theme_configs
group by theme_id;

select theme_id, count(*) as rows
from public.site_theme_history
group by theme_id;
