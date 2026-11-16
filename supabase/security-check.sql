-- UNDERGROUND — read-only security self-check for the admin panel (Settings → Security check).
-- Run once in Supabase → SQL Editor. Safe to re-run. It changes no data and no rules:
-- the two test inserts run inside sub-transactions that are always rolled back.
-- SECURITY INVOKER: it runs with the caller's own session, so RLS applies exactly as in the panel.

create or replace function public.ug_security_check()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  claims jsonb := auth.jwt();
  admin_row boolean;
  plain_result text := 'not run';
  returning_result text := 'not run';
  new_id text;
  res jsonb;
begin
  select exists (select 1 from public.admin_users where user_id = auth.uid()) into admin_row;

  -- Test 1: INSERT without RETURNING (only the INSERT rules apply)
  begin
    insert into public.articles (title, slug, excerpt, content, status, author_id, genre, updated_at)
    values ('security check', 'ug-security-check-' || md5(random()::text), '', 'security check', 'draft', auth.uid(), 'Underground', now());
    raise exception 'UG_ROLLBACK';
  exception when others then
    plain_result := case when sqlerrm = 'UG_ROLLBACK' then 'ok' else sqlstate || ': ' || sqlerrm end;
  end;

  -- Test 2: INSERT ... RETURNING, exactly like the admin panel (the SELECT rules apply too)
  begin
    insert into public.articles (title, slug, excerpt, content, status, author_id, genre, updated_at)
    values ('security check', 'ug-security-check-' || md5(random()::text), '', 'security check', 'draft', auth.uid(), 'Underground', now())
    returning id::text into new_id;
    raise exception 'UG_ROLLBACK';
  exception when others then
    returning_result := case when sqlerrm = 'UG_ROLLBACK' then 'ok' else sqlstate || ': ' || sqlerrm end;
  end;

  res := jsonb_build_object(
    'uid', auth.uid(),
    'role', claims ->> 'role',
    'aal_claim_in_database', claims ->> 'aal',
    'amr', claims -> 'amr',
    'admin_row', admin_row,
    'ug_is_admin', public.ug_is_admin(),
    'ug_mfa_ok', public.ug_mfa_ok(),
    'insert_without_returning', plain_result,
    'insert_with_returning', returning_result
  );
  if admin_row then
    res := res || jsonb_build_object('article_policies', (
      select jsonb_agg(jsonb_build_object('name', policyname, 'permissive', permissive, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check) order by cmd, policyname)
      from pg_policies where schemaname = 'public' and tablename = 'articles'));
  end if;
  return res;
end;
$$;
revoke all on function public.ug_security_check() from public;
grant execute on function public.ug_security_check() to authenticated;

notify pgrst, 'reload schema';
