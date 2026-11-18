# Database (Supabase)

- Project ref `lhhmzfwjznlwkentbakv`, region Singapore.
- Postgres with Row Level Security (RLS) on every application table.
- Audited against `supabase/*.sql` on 2026-11-17.

> **Important: the base schema is not in this repository.** The tables `articles`, `categories` and `admin_users` were created in the Supabase dashboard before the SQL files existed. Their columns below are **taken from how the code uses them**, not from a schema dump. One live policy, "Admins can read all articles", was also created in the dashboard (see [section 6](#6-incident-insert-returning-blocked-by-rls-2026-11-17)). To get the real definitions, run the queries in [section 7](#7-verifying-the-database).

## 1. SQL files and the order to apply them

Every file is idempotent ("safe to re-run"): `create … if not exists`, `create or replace`, and `drop policy if exists` before `create policy`. Run each one in Supabase → **SQL Editor**.

| # | File | Purpose | Depends on |
| --- | --- | --- | --- |
| 0 | *(dashboard, not in repo)* | `articles`, `categories`, `admin_users` and their original policies | — |
| 1 | `supabase/community.sql` | `ug_is_admin()`, `profiles` (+ sign-up trigger), `saved_articles`, `comments`, `demo_submissions`, rate-limit triggers | `articles` |
| 2 | `supabase/music.sql` | `tracks`, storage bucket `music` (25 MB, public read), storage policies, `ug_admin_purge()` | 1 |
| 3 | `supabase/music-v2.sql` | `tracks.album`, `tracks.release_year` + checks | 2 |
| 4 | `supabase/charts.sql` | `track_ratings`, `ug_chart_tracks`, `ug_chart_bands`, `ug_track_rating` | 2 |
| 5 | `supabase/extras.sql` | `articles.kind/score`, `ug_band_rating`, `newsletter_subscribers`, `ug_subscribe`, unsubscribe token + `ug_unsubscribe`, `ug_delete_my_account`, `gigs` (unused), `ug_admin_purge` (extended) | 1–4 |
| 6 | `supabase/security.sql` | Admin powers need 2FA: `ug_is_admin()` requires `aal2`, `ug_mfa_ok()`, restrictive policies on `articles` and `categories` | 1–5, **and the admin must have set up 2FA first** |
| 7 | `supabase/security-check.sql` | `ug_security_check()` diagnostic (read-only, test inserts rolled back) | 6 |
| 8 | `supabase/telegram.sql` | `telegram_radar` for the Telegram bot (service key only) | — |
| 9 | `supabase/themes.sql` | Theme Manager: `site_theme_active`, `site_theme_configs`, `site_theme_history`, `ug_clean_theme_tokens`, `ug_theme_id_ok`, `ug_active_theme`, `ug_apply_theme`, `ug_restore_theme`, `ug_reset_theme` | 6 (`ug_is_admin()` with 2FA). **PENDING: owner reviews the file, then runs it** |

Owner-reported state on 2026-11-17: files 6 and 7 applied; 2FA working; "Admins can read all articles" added. The application status of files 1–5 is inferred from working features, not from a schema dump.

⚠️ `community.sql`, `music.sql` and `security.sql` all define `ug_is_admin()`. Since 2026-11-17 **all three contain the 2FA version**. Never re-introduce the old body (admin membership only) in any file, or a re-run would silently drop the 2FA requirement.

## 2. Tables

### `articles` *(base schema, not in repo)*
Columns used by the code: `id` (type not documented; `community.sql` detects it at run time), `title`, `slug` (unique, so the code retries with a suffix on `23505`), `excerpt`, `content` (Markdown), `band_name`, `album_name`, `genre`, `category_id` → `categories.id`, `cover_image_url`, `tags` (array), `status` (`draft` | `review` | `published`), `published_at`, `created_at`, `updated_at`, `author_id` (auth user id), plus from `extras.sql`:

- `kind` text: `Review` | `News` | `Feature` | `Interview`, or null
- `score` numeric(3,1): 0–10, or null

Conventions:

- **AI drafts** contain a line `\n\nSource: [<site>](<link>)`. The admin "AI drafts waiting" banner and "✓ Written" in Scene Radar rely on it.
- `published_at` may be preset to the source's original time.

### `categories` *(base schema, not in repo)*
Used columns: `id`, `slug`. The admin looks up `category_id` by `slug = slugify(genre)`. Not every genre has a category row; null is allowed.

### `admin_users` *(base schema, not in repo)*
Used column: `user_id` (auth user id). Membership = admin. Owner-reported RLS: a user can read only their own row. Rows are added by hand in the SQL editor (see [SECURITY.md](SECURITY.md#admin-membership)).

### `profiles` (`community.sql`)
`id` uuid PK → `auth.users.id` on delete cascade, `display_name` (2–40 chars), `favorite_genres` text[] (≤ 8), `created_at`, `updated_at`. Created automatically by trigger `ug_on_auth_user_created` → `ug_handle_new_user()` (name from sign-up metadata, else from the email). RLS: public read; users insert and update only their own row.

### `saved_articles` (`community.sql`)
`user_id` → `profiles.id` (cascade), `article_id` → `articles.id` (cascade), `created_at`; PK `(user_id, article_id)`. RLS: own rows only; saving is allowed only for published articles.

### `comments` (`community.sql`)
`id` uuid, `article_id` → `articles.id` (cascade), `user_id` → `profiles.id` (cascade), `body` (1–2000 chars), `created_at`. Index `comments_article_idx (article_id, created_at)`. Trigger `ug_comment_rate_limit`: at most 5 per member per minute. RLS: read on published articles; members insert as themselves on published articles; delete by author or admin.

### `demo_submissions` (`community.sql`)
`id`, `user_id` → `profiles.id` (cascade), `band_name`, `country`, `genre`, `link` (must be `https://…`), `message`, `contact_email`, `status` (`new` | `listened` | `featured` | `declined`), `created_at`. Index on `created_at desc`. Trigger `ug_demo_rate_limit`: at most 3 per member per day. RLS: members insert their own and see their own; admins see, update and delete all.

### `tracks` (`music.sql`, `music-v2.sql`)
`id` uuid, `title`, `artist` (1–160), `genre` (≤ 40), `description` (≤ 1000), `audio_path`, `audio_url` (https), `cover_path`, `cover_url` (https), `duration_sec` (0–7200), `status` (`draft` | `published`), `published_at`, `created_at`, `updated_at`, `album` (≤ 160), `release_year` (1900–2100). Index `tracks_published_idx (status, published_at desc)`. RLS: published public (admins see all); admin insert, update and delete.

### `track_ratings` (`charts.sql`)
`track_id` → `tracks.id` (cascade), `user_id` → `auth.users.id` (cascade), `stars` 1–5, `created_at`, `updated_at`; PK `(track_id, user_id)`. Index `track_ratings_updated_idx`. RLS: members read their own and rate published tracks only. Aggregates are exposed only through security-definer RPCs.

### `newsletter_subscribers` (`extras.sql`)
`id`, `email` (validated; unique on `lower(email)`), `source`, `created_at`, `token` uuid (unique; used in unsubscribe links). RLS: **admins only** (select, delete). Inserts go only through `ug_subscribe`.

### `gigs` (`extras.sql`), unused
`id`, `title`, `bands` text[], `venue`, `city`, `starts_at`, `ticket_url`, `poster_url`, `price`, `description`, `status` (`draft` | `published`), `created_at`, `updated_at`; index `gigs_upcoming_idx (status, starts_at)`. The feature was removed from the site; the table remains. Do not build on it without asking the owner.

### Storage bucket `music` (`music.sql`)
Public read, 25 MB per file (`26214400`), audio and image MIME types only, admin-only writes through `storage.objects` policies. Used only when R2 is not available.

### `telegram_radar` (`supabase/telegram.sql`)
Headlines the Telegram bot has sent: `hash` (pk, short SHA-256 of the link), `link`, `title`, `item` jsonb (headline, source, summary, date, image, band, genres), `status` (`sent` / `writing` / `drafted` / `skipped`), `article_id`, `sent_at`, `updated_at`. RLS on with **no policies** and grants revoked from `anon`/`authenticated`: only the server's service key uses it. Status: PENDING (owner must run the SQL).

### Theme Manager (`supabase/themes.sql`, PENDING)
| Table | Contents | Visitors | Signed-in non-admin | Admin with 2FA |
| --- | --- | --- | --- | --- |
| `site_theme_active` | one row (`id = 1`): `theme_id`, `tokens`, `version`, `config_id`, `applied_by`, `applied_at` | no table access; read `{theme, tokens, version}` through `ug_active_theme()` | nothing | read; write only through the functions |
| `site_theme_configs` | saved configurations/drafts: `theme_id`, `name`, `tokens`, `note`, `created_by`, timestamps | none | none (RLS) | read, insert, update, delete |
| `site_theme_history` | every Apply/Restore/Reset: `action`, `theme_id`, `tokens`, `version`, `config_id`, `applied_by`, `applied_at`, `note` | none | none | read only |

- Privileges are revoked from `anon` on all three tables; `authenticated` has only SELECT on active/history and S/I/U/D on configs, filtered by RLS (`ug_is_admin()`).
- Tokens are cleaned by `ug_clean_theme_tokens()` (trigger on configs, and inside every apply). It mirrors `assets/theme/schema.js`; a parity test checks both give identical output. **Change both together.**
- `ug_apply_theme(theme_id, tokens, config_id, note)`, `ug_restore_theme(history_id)`, `ug_reset_theme()` are SECURITY DEFINER with `search_path = ''`, check `ug_is_admin()` first, and write the active row + a history row in one transaction (`version` increases by 1 each time; parallel applies never share a version). The internal `ug_theme_write()` is not executable by any client role.
- Theme ids are checked against the catalogue in `ug_theme_id_ok()` (keep in sync with `THEMES` in `schema.js`). Whether a theme is ready is decided by the code; the site falls back to `neon-bento` for any theme that is not.
- Tested on PostgreSQL 16 with a Supabase-style role setup (2026-11-18): 49 checks (visitors, non-admin, admin without 2FA, admin with 2FA, history/restore/reset, concurrency, definer hardening) + 25 validator parity cases. Not yet run on the production database.

## 3. Relationships

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "id (cascade)"
  AUTH_USERS ||--o| ADMIN_USERS : "user_id"
  PROFILES ||--o{ SAVED_ARTICLES : user_id
  PROFILES ||--o{ COMMENTS : user_id
  PROFILES ||--o{ DEMO_SUBMISSIONS : user_id
  AUTH_USERS ||--o{ TRACK_RATINGS : user_id
  ARTICLES ||--o{ SAVED_ARTICLES : article_id
  ARTICLES ||--o{ COMMENTS : article_id
  CATEGORIES ||--o{ ARTICLES : category_id
  TRACKS ||--o{ TRACK_RATINGS : track_id
```

Band pages link articles and tracks **by name**, not by foreign key (`articles.band_name` matched with `ilike`; `tracks.artist` normalised in `ug_band_rating`). There is no `bands` table.

## 4. Functions (RPC) and triggers

| Function | Security | Called by | Purpose |
| --- | --- | --- | --- |
| `ug_is_admin()` | definer | RLS policies, `ug_admin_purge` | Caller is in `admin_users` **and** JWT `aal = 'aal2'` |
| `ug_mfa_ok()` | definer | restrictive policies (`security.sql`) | True for non-admins; for admins only with `aal2` |
| `ug_handle_new_user()` | definer, trigger on `auth.users` insert | Supabase Auth | Creates the profile |
| `ug_comment_rate_limit()` | definer, trigger | comments insert | 5 per minute |
| `ug_demo_rate_limit()` | definer, trigger | demo insert | 3 per day |
| `ug_admin_purge(text[])` | definer | admin Settings → Clean up data | Deletes `comments`, `saved`, `articles`, `tracks`, `demos`, `gigs` (needs `ug_is_admin`) |
| `ug_chart_tracks(period, limit, genres)` | definer | Charts | Bayesian-ranked tracks |
| `ug_chart_bands(period, limit, genres)` | definer | Charts | Ranked artists |
| `ug_track_rating(uuid)` | definer | player | Average and votes for one track |
| `ug_band_rating(text)` | definer | band page | Members' average for an artist |
| `ug_subscribe(email, source)` | definer | newsletter forms (anon) | Validated, flood-guarded insert |
| `ug_unsubscribe(uuid)` | definer | `/unsubscribe` function | Delete by token |
| `ug_delete_my_account()` | definer | Account page | Deletes the caller (refuses admins); cascades remove profile, comments, saves, ratings, demos; also removes their newsletter row |
| `ug_security_check()` | **invoker** | admin Settings → Security check | Reports `aal`, admin flags, two rolled-back test inserts, article policies |

## 5. RLS model and MFA

Two kinds of policies are combined:

- **Permissive** policies (the normal kind): *at least one* must pass. For example "public reads published", "admins write".
- **Restrictive** policies (`as restrictive`, from `security.sql`): *all* must pass, on top of the permissive ones. They add "admins only with aal2" without touching the original policies, whose exact text is not in the repo.

How 2FA is enforced in the database:

- `ug_is_admin()` returns true only for an admin whose JWT has `aal = 'aal2'`. Every policy that uses it (tracks, storage, demos, comments moderation, newsletter, purge) therefore needs 2FA.
- On `articles` (insert, update, delete, and select of non-published rows) and `categories` (insert, update, delete), the restrictive policies call `ug_mfa_ok()`, which is true for everyone except an admin without `aal2`.

Members and anonymous visitors are not affected.

## 6. Incident: INSERT RETURNING blocked by RLS (2026-11-17)

**Symptom.** Admin "Save draft" and Scene Radar "Write as drafts" failed with:
`new row violates row-level security policy for table "articles"`, even after 2FA was verified and `security.sql` was applied. AI generation (which already checks `aal2`) succeeded, so the token was fine.

**Diagnosis.** `supabase/security-check.sql` + admin → Settings → **Security check** (run by the owner) showed:

| Check | Result |
| --- | --- |
| Browser AAL | `aal2` |
| Access token `aal` claim | `aal2` |
| `aal` seen by the database | `aal2` |
| `admin_row` / `ug_is_admin()` / `ug_mfa_ok()` | true / true / true |
| INSERT without RETURNING | ok |
| INSERT with RETURNING | **failed** (SELECT policy) |

**Cause.** The admin panel saves with `insert(...).select("id")`, which is `INSERT … RETURNING`. In PostgreSQL, rows returned by `RETURNING` must also pass the table's **SELECT** policies. The original select policy only allowed `status = 'published'`, so a new **draft** could be inserted but not read back. Postgres reports this with the same "new row violates row-level security policy" message as an INSERT failure, which is misleading.

**Fix (applied by the owner in the dashboard).** A permissive SELECT policy, **"Admins can read all articles"**, for `authenticated` users listed in `admin_users`. The restrictive policy "Admin needs 2FA to read drafts" still applies on top, so drafts are readable only by admins **with aal2**. Verified by the owner: Save Draft works; the draft appears in the list; Scene Radar shows "✓ Written".

**Why RLS and MFA stayed on.** The failure was a missing read permission, not an over-strict rule. Disabling RLS or MFA would have hidden the real cause and exposed drafts and writes.

**Pending.** The exact SQL of "Admins can read all articles" is not in the repo yet. Copy it from `pg_policies` (section 7) into a migration file so a rebuilt database gets it.

**How to avoid this with new tables or features:**
1. For every table the admin writes with `.select()` after insert or update, make sure a **SELECT policy covers the new row** (drafts, unpublished, private rows).
2. Test both forms: plain insert and insert + returning. `ug_security_check()` shows the pattern to copy.
3. Put admin-only rules behind `ug_is_admin()` (it already requires `aal2`). Do not write `exists (select 1 from admin_users …)` directly in new policies.
4. When an RLS error appears, diagnose with the Security check before changing any policy.

## 7. Verifying the database

These queries are read-only. Run them in Supabase → SQL Editor.

```sql
-- policies of a table
select policyname, permissive, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'articles';

-- columns of a table
select column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema = 'public' and table_name = 'articles'
order by ordinal_position;

-- our functions
select proname, prosecdef as security_definer from pg_proc
where pronamespace = 'public'::regnamespace and proname like 'ug\_%' order by 1;

-- RLS on?
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
```

The SQL editor runs as `postgres` (no JWT), so `auth.uid()` and `aal` are empty there. To test what a **signed-in admin** sees, use admin → Settings → **Security check**.

## 8. Rules for database changes
- Every change is a new or updated file in `supabase/`, idempotent, with a header comment saying what it does and what it must run after.
- Destructive SQL (drop, delete, truncate, disabling RLS) only with the owner's explicit approval.
- Update this file and [PROJECT-STATUS.md](PROJECT-STATUS.md) in the same commit.
