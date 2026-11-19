-- Add Monochrome Modular to the existing Theme Manager catalogue.
-- Apply only after the matching application release is reviewed and approved.
begin;
create or replace function public.ug_theme_id_ok(p_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_id = any (array[
    'neon-bento','front-page','the-pit','setlist','mosh-grid','control-room',
    'main-stage','xerox-zine','index','frequency','scene-atlas','monochrome-modular'
  ]);
$$;
revoke all on function public.ug_theme_id_ok(text) from public, anon, service_role;
grant execute on function public.ug_theme_id_ok(text) to authenticated;
commit;
