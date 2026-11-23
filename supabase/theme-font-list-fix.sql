-- UNDERGROUND — fix the theme token validator's font allow-list. Run ONCE in Supabase → SQL Editor.
-- Safe to re-run (it only replaces one function; it creates, drops or deletes no data).
--
-- Why: supabase/themes.sql (applied by the owner on 2026-11-18) shipped a font allow-list that was
-- missing two fonts the site actually offers: "anton" and "space-grotesk". ug_clean_theme_tokens()
-- silently drops any token whose value is not in that list, and the *_tokens_clean CHECK constraints
-- reject a row whose tokens differ from its output. So choosing Anton or Space Grotesk in the Theme
-- Manager was quietly ignored by the database. This replaces only that one function with the correct
-- list. Nothing else changes; the tables, policies and the other functions stay exactly as they are.
--
-- Keep this list in sync with FONTS in assets/theme/schema.js. tests/themes.test.mjs enforces it.
-- supabase/themes.sql already carries the corrected list for future rebuilds.

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

notify pgrst, 'reload schema';
