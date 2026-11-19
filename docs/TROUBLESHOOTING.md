# Troubleshooting

Every entry below happened in this project or is a likely failure of an existing feature. Diagnose before changing anything. **Never "fix" an error by disabling RLS, 2FA or security headers.**

---

## RLS: `new row violates row-level security policy for table "articles"`
**Symptom:** Save draft, Publish, or Scene Radar "Write as drafts" fails with that message. AI generation may still work.

**Possible causes:**
- (a) `INSERT … RETURNING` needs a **SELECT** policy that covers the new row. A new draft is not "published". This is the real cause from 2026-11-17.
- (b) The session is not `aal2`, so the restrictive policies from `security.sql` block an admin.
- (c) The user is not in `admin_users`.
- (d) A policy written in the dashboard has a different condition (`author_id`, `status`, and so on).

**Diagnosis:**
1. Admin → Settings → **Security check** (needs `supabase/security-check.sql` installed).
2. Compare lines 4 (insert only) and 5 (insert with RETURNING):
   - **4 ok, 5 failed:** a SELECT policy is missing for that row. That was the case on 2026-11-17.
   - **4 failed:** an INSERT policy blocks. Read the listed policies: which `check` is false for this row?
   - **Line 3 `aal` empty or `aal1`, `ug_mfa_ok = false`:** see the next entry.

**Safe fix:**
- For (a), add or adjust a **permissive SELECT** policy for admins, e.g. "Admins can read all articles" (`to authenticated using (public.ug_is_admin())` is the recommended form, since it also requires 2FA).
- Commit the SQL to `supabase/` and document it in [DATABASE.md](DATABASE.md).

Full write-up: [DATABASE.md §6](DATABASE.md#6-incident-insert-returning-blocked-by-rls-2026-11-17).

---

## AAL2 not seen (2FA done but still blocked)
**Symptom:** API answers `403` with `"mfa": true` ("Two-step verification required…"), or Security check line 1 or 2 shows `aal1`.

**Causes:**
- The page was opened before verifying.
- The session came from another tab that signed in again (a new `aal1` session).
- The verified factor was deleted in the dashboard.

**Diagnosis:** Security check lines 1–3 show the browser AAL, the token claim and the database claim.

**Fix:** reload `admin.html` and enter the code. If the 2FA screen asks to **set up** again, the factor was removed: scan the new QR code. If line 2 shows `aal2` but line 3 does not, check that `security.sql` was applied unmodified (`ug_mfa_ok` reads `auth.jwt() ->> 'aal'`).

---

## Admin cannot get in
**Symptom:** `admin.html` redirects to the Account page, or shows the 2FA screen with an error.

**Diagnosis and fix:**
- **Redirect while signed out:** sign in on the Account page first, then use **Admin panel** on the profile.
- **Redirect while signed in:** the user is not in `admin_users`. In the SQL editor: `select * from admin_users;` then insert the user id (see [SECURITY.md](SECURITY.md#admin-membership)).
- **"Could not start two-step setup":** turn on Supabase → Authentication → Multi-Factor → TOTP.
- **"Code not accepted":** the phone's clock is wrong (set automatic time), or the code expired. Use the newest code.
- **Lost authenticator:** Supabase → Authentication → Users → the admin → remove the MFA factor, then enrol again.

---

## AI provider fails
**Symptom:** toast "All AI providers failed" with a list of `provider: reason`, or a slow generation.

**Causes:**
- missing or invalid key
- model name no longer offered
- quota exhausted (Workers AI daily neurons, free tiers)
- 75 s deadline reached

**Diagnosis:** the `attempts` list in the toast or in the `/api/generate` JSON. A "Server is not configured" error means the site was opened on a **preview** URL without secrets: use `music.mikasa.me`.

**Fix:** correct or add a key in Cloudflare (Secret), or set `AI_PROVIDER_ORDER` to put a working provider first, then redeploy. Do not paste keys anywhere else.

---

## Music upload fails
**Symptoms and fixes:**
- **"The current storage (Supabase) allows 25 MB":** R2 is not connected. See the next entry.
- **"The maximum is 100 MB per song":** a hard limit. Compress the file.
- **`403` with `mfa: true`:** see "AAL2 not seen".
- **`413`:** the single upload is too large. The admin should switch to chunked uploads automatically above 20 MB. If you see 413, check that `CHUNK` and `/api/music/status` return `chunkBytes`.
- **Upload stops halfway:** network problem. The admin aborts the multipart upload; retry.
- **Unsupported type:** only MP3, M4A/AAC, OGG, WAV and FLAC are accepted.

---

## R2 not detected
**Symptom:** `/api/music/status` returns `{"r2": false}`, or files answer 503 "Storage not connected".

**Fix:**
1. Cloudflare → Pages project → Settings → **Bindings**: an R2 binding named exactly `MUSIC` must point at bucket `underground-music`.
2. Add it to the **Production** environment.
3. **Redeploy.** Bindings apply only to new deployments.

---

## Scheduled draft fails (GitHub Actions red)
Read the run log (Actions → Daily AI drafts):

| Result | Meaning | Fix |
| --- | --- | --- |
| `401 Not allowed` | `AUTODRAFT_TOKEN` differs between GitHub and Cloudflare | set the same value in both, then redeploy |
| `503` + `variables_seen` | Supabase secret key missing under an accepted name | add `SUPABASE_SERVICE_ROLE_KEY`, then redeploy |
| `502 No headlines` | all feeds failed | check `/api/news?refresh=1` |
| `502` + `failed[]` | AI or insert errors | see the AI entry; an insert error shows the DB message |
| `200` + `note` | nothing new to write | normal |

Digests and deals are filtered by `NOT_NEWS` in `draft-lib.js`. Adjust the regex there if a non-news item slips through.

---

## Newsletter not sent
**Symptom:** error in admin → Settings → newsletter.

**Causes:**
- "Email sending is not set up yet": `RESEND_API_KEY` or `NEWSLETTER_FROM` is missing.
- Resend rejects the sender domain: `mikasa.me` is not verified, or the `send.` DNS records were removed.
- Free plan limits (100 emails per day, 3,000 per month).
- `403 mfa`: see "AAL2 not seen".

**Diagnosis:** **Send test to me** first. The Resend dashboard → Emails shows delivery logs.

**Fix:** set the variables, redeploy, and re-verify the domain in Resend.

---

## Deezer returns nothing (charts or band pages empty)
**Causes:**
- Deezer API down or rate-limited.
- No playlist matches a niche genre.
- An old empty result is cached (6 h for charts, 6 h for band misses, 1 day for cover misses).

**Diagnosis:** open `/api/charts?genre=<name>` or `/api/band?name=<band>` directly. The default chart falls back from playlists to the Metal genre artists.

**Fix:** wait for the cache to expire. If the code changed the data format, bump the cache key (`v=4` in `charts.js`, `v=2` in `band.js`). Never call Deezer from the browser: it is not in the CSP, and its preview links expire.

---

## Scene Radar source missing
**Symptom:** "unavailable: New Noise" under the radar.

**Cause (VERIFIED 2026-11-17):** New Noise serves a captcha (SiteGround anti-bot) to all automated requests, including its RSS feed.

**Fix:** none on our side. Do not try to bypass it. Remove the source from `SOURCES` in `functions/api/news.js`, or replace it with another feed.

---

## Cloudflare deployment fails
- **Diagnosis:** GitHub check run "Cloudflare Pages" fails → Cloudflare → Deployments → View details.
- **Common causes:** a JavaScript syntax error in `functions/`, an import path typo (`../aal.js` vs `./aal.js`), or the Functions bundle size limit.
- **Fix:** test-import changed functions locally with `node --input-type=module -e "import('file:///…/functions/api/x.js')"`, fix, push, then confirm the check run.
- **Site loads but something is blank after a header change:** open the browser console and look for "Content Security Policy" errors. Add the missing host to `_headers` **and** `SECURITY_HEADERS` in `functions/api/theme/edge.js` (HTML pages get their headers from the middleware). Never remove the CSP.

---

## Preview URL behaves differently
Preview deployments (`<branch>.underground-music.pages.dev`) may lack production secrets and bindings. "Server is not configured" there is expected. Test real flows on `music.mikasa.me`.

## Theme does not change after Apply
- Check the header: `curl -s -D - -o /dev/null https://music.mikasa.me/ | grep -i x-ug-theme`.
  - `…;stale` or `…;cache-stale` → the database could not be read just now (slow, down, bad answer); the
    last valid theme is shown. It recovers by itself within 15 s of the database answering again.
  - `neon-bento@0;fallback` → the middleware has never read a valid theme at this location (SQL not run,
    Supabase down, or wrong `SUPABASE_URL`). The site correctly falls back to Neon Bento.
  - Old version number → wait up to 30 s (edge cache in other data centres), then reload.
- Theme Manager shows "Database tema belum disiapkan" → run `supabase/themes.sql` in the Supabase SQL editor.
- Apply refused with "not allowed" → log in again and pass 2FA (aal2 is required).
- A broken theme → admin → Settings → Tema situs → **Reset ke default** (Neon Bento), or Restore an older version.

