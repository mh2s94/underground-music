-- UNDERGROUND — two-step verification for admin powers in the database.
-- Run ONCE in Supabase → SQL Editor, but only AFTER you have set up 2FA in the admin panel
-- (open music.mikasa.me/admin.html, scan the QR code, enter the code). Safe to re-run.
--
-- What it does: every admin-only rule (articles, music, demos, comments moderation, newsletter
-- subscribers, purge) now also requires a session that passed the 6-digit code (aal2).
-- A stolen admin password alone can no longer change anything. Members are not affected.

-- 1. "Is admin" now means: listed in admin_users AND verified with the second step.
create or replace function public.ug_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke all on function public.ug_is_admin() from public;
grant execute on function public.ug_is_admin() to anon, authenticated;

-- 2. Helper for tables whose rules were created outside these files (articles, categories):
--    true for everyone who is not an admin, and for admins only after the second step.
create or replace function public.ug_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.ug_mfa_ok() from public;
grant execute on function public.ug_mfa_ok() to anon, authenticated;

-- 3. Restrictive rules are added ON TOP of the existing ones (both must pass).
--    Reading published articles stays public; drafts and every write need the second step.
drop policy if exists "Admin needs 2FA to read drafts" on public.articles;
create policy "Admin needs 2FA to read drafts" on public.articles as restrictive for select
  using (status = 'published' or public.ug_mfa_ok());
drop policy if exists "Admin needs 2FA to add" on public.articles;
create policy "Admin needs 2FA to add" on public.articles as restrictive for insert to authenticated
  with check (public.ug_mfa_ok());
drop policy if exists "Admin needs 2FA to edit" on public.articles;
create policy "Admin needs 2FA to edit" on public.articles as restrictive for update to authenticated
  using (public.ug_mfa_ok()) with check (public.ug_mfa_ok());
drop policy if exists "Admin needs 2FA to delete" on public.articles;
create policy "Admin needs 2FA to delete" on public.articles as restrictive for delete to authenticated
  using (public.ug_mfa_ok());

drop policy if exists "Admin needs 2FA to add categories" on public.categories;
create policy "Admin needs 2FA to add categories" on public.categories as restrictive for insert to authenticated
  with check (public.ug_mfa_ok());
drop policy if exists "Admin needs 2FA to edit categories" on public.categories;
create policy "Admin needs 2FA to edit categories" on public.categories as restrictive for update to authenticated
  using (public.ug_mfa_ok()) with check (public.ug_mfa_ok());
drop policy if exists "Admin needs 2FA to delete categories" on public.categories;
create policy "Admin needs 2FA to delete categories" on public.categories as restrictive for delete to authenticated
  using (public.ug_mfa_ok());

notify pgrst, 'reload schema';
