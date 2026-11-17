# Project status

Last audit: **2026-11-17**, against `main`. Update this file with every change.

## Status labels
- **VERIFIED:** checked live on production by the owner, or by CI or GitHub Actions results. The evidence is named.
- **IMPLEMENTED, NOT VERIFIED:** the code exists and may have passed local or mock tests, but has not been confirmed live.
- **PENDING:** needs configuration or an action (mostly by the owner), or is not built.

## Features

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Public site on `music.mikasa.me` | VERIFIED | custom domain active; deployments succeed |
| Redirect from `underground-music.pages.dev` | IMPLEMENTED, NOT VERIFIED | inline script |
| Articles, reader, `/a/<slug>` SEO pages | IMPLEMENTED, NOT VERIFIED | Google indexing not confirmed |
| Review scores (`kind`, `score`) | IMPLEMENTED, NOT VERIFIED | needs `extras.sql`, assumed applied |
| Admin newsroom: AI generator, Save, Publish | VERIFIED | owner, 2026-11-17 (draft saved after RLS fix) |
| Scene Radar (public wire + admin) | VERIFIED | 6 of 7 sources work; New Noise blocked by captcha |
| Scene Radar Auto-write (single) | VERIFIED | used by owner |
| Scene Radar batch "Write as drafts" + Publish all | IMPLEMENTED, NOT VERIFIED | mock-tested; first live try hit the RLS bug; not re-run after the fix |
| Daily AI drafts (GitHub Actions) | VERIFIED | run `43867308189` (2026-11-16) created 2 drafts via `workersai`; later scheduled runs not checked |
| Visitor accounts (sign up, sign in, reset) | IMPLEMENTED, NOT VERIFIED in this audit | Supabase dashboard settings not visible from repo |
| Account page design (Amp Head, rack slide) | IMPLEMENTED | mock-tested at 412 px and 1280 px |
| Comments, saved articles, demos (+ rate limits) | IMPLEMENTED, NOT VERIFIED | |
| Account self-deletion | IMPLEMENTED, NOT VERIFIED | |
| Music upload ≤ 25 MB (Supabase Storage) | IMPLEMENTED, NOT VERIFIED in this audit | |
| Music upload ≤ 100 MB (R2, chunked) | IMPLEMENTED, NOT VERIFIED (upload) | `MUSIC` binding to bucket `underground-music` VERIFIED in the Cloudflare dashboard (owner screenshot 2026-11-17) |
| Music auto-fill (tags + `/api/track-info`) | IMPLEMENTED, NOT VERIFIED since 2FA | |
| Player, Now Playing ("Floating Island") | IMPLEMENTED | design chosen by owner |
| Global charts (Deezer) + playable previews | VERIFIED | owner confirmed |
| Community ratings and charts | IMPLEMENTED, NOT VERIFIED | |
| Genre taxonomy (30 groups, ~415 genres) | IMPLEMENTED | two copies must stay identical |
| Band profiles `/band/<slug>` | IMPLEMENTED, NOT VERIFIED | |
| Search (`/`, Ctrl+K, `?q=`) | IMPLEMENTED, NOT VERIFIED | |
| Newsletter sign-up | IMPLEMENTED, NOT VERIFIED | |
| Newsletter sending (Resend) | VERIFIED | test email received (before 2FA was added to the route) |
| Unsubscribe links | IMPLEMENTED, NOT VERIFIED | |
| Gigs / calendar | REMOVED from site | table `gigs` remains unused |
| Motion polish A–G (hover lift fix, mobile hover, hero entrance, spotlight, avatar dot, equalizers, spring) | VERIFIED on preview by owner; deployed 2026-11-17 (PR #42) | live check on music.mikasa.me pending |
| Launch motion "09 Mosh Pit" | IMPLEMENTED | chosen by owner on a live preview |
| Privacy, Terms pages | IMPLEMENTED | |
| Cloudflare Web Analytics | VERIFIED | enabled by owner |
| Google Search Console | VERIFIED (ownership) / PENDING (indexing) | |

## Security

| Item | Status | Evidence / notes |
| --- | --- | --- |
| RLS on articles and admin_users | VERIFIED | owner checked policies |
| Admin 2FA (panel, API, DB) | VERIFIED | owner enrolled; `security.sql` applied; Security check shows aal2 |
| "Admins can read all articles" SELECT policy | VERIFIED live / PENDING in repo | created in dashboard; its SQL must be copied into `supabase/` |
| Admin page hidden from visitors | IMPLEMENTED, NOT VERIFIED live | mock-tested (guest, member, admin) |
| CSP + HSTS headers | IMPLEMENTED, NOT VERIFIED live | local CSP test had no violations |
| Turnstile captcha | PENDING | owner must create a widget and send the **site key** |
| Cloudflare rate-limiting rule for `/api/*` | PENDING | owner action (steps in SECURITY.md) |
| Rotate `AUTODRAFT_TOKEN` | PENDING | the old value appeared in a chat transcript |
| DMARC record | PENDING confirmation | recommended value in DEPLOYMENT.md |

## Waiting for the owner
1. Copy the SQL of "Admins can read all articles" (from `pg_policies`) so it can be added to `supabase/security.sql`.
2. Turnstile: create the widget, send the site key, then add the secret key in Supabase **after** the code is deployed.
3. Cloudflare rate-limiting rule for `/api/*` (do not enable Bot Fight Mode).
4. Rotate `AUTODRAFT_TOKEN` in Cloudflare **and** GitHub, then redeploy.
6. Decide whether to replace or remove New Noise in Scene Radar.
7. Delete the leftover GitHub branch `radar-audit` (optional).
8. Decide whether to move the site into a `public/` folder so docs and SQL are no longer downloadable (see below).

## Known issues and risks
- **Repo root is the public output directory.** `README.md`, `docs/*` and `supabase/*.sql` are downloadable from the site. They hold no secrets but reveal the architecture. Fix: move the site files into `public/` and change the Pages output directory. Needs approval.
- **The base schema is not in the repo:** `articles`, `categories` and `admin_users` were created in the dashboard. Their columns in DATABASE.md are inferred from the code. Export the real definitions when possible.
- **New Noise** RSS blocked by captcha.
- **The charts header comment** in `functions/api/charts.js` still describes the old genre-artist method as the default. The code uses Metal playlists first. The comment is stale; the behaviour is correct.
- **The old admin login form** in `admin.html` is unused (sign-in now happens on the Account page).
- **Model defaults** in `generate.js` (for example `gemini-3.8-flash`, `gpt-6-astra`) are not verified against each vendor's current model list.

## Tests done (2026-11-16/17)
- Playwright with a stubbed Supabase:
  - admin gate (guest, member, admin)
  - 2FA enrol, verify, wrong code
  - Scene Radar batch (5 picks, 6th blocked, Publish all)
  - CSP on home, account and admin (no violations)
  - account page and launch motion at 412 px and 1280 px
- Live, by the owner:
  - 2FA
  - Security check
  - Save draft after the RLS fix
  - the newsletter test email
  - charts previews
- GitHub Actions: auto-draft run `43867308189` succeeded. Every merge's "Cloudflare Pages" check succeeded.

## Check next session
- Run Scene Radar **Write as drafts** live once (after the RLS fix).
- Music upload live: one small file, and one over 25 MB if R2 is on.
- `/api/track-info` and `/api/newsletter/send` with an `aal2` session.
- That the security headers are present on production (browser devtools → Network → response headers), with no CSP errors in the console.
- Recent "Daily AI drafts" runs in GitHub Actions.

## Cancelled
- **RADAR Intelligence / ALL POSTS SCAN** (2026-11-17): a large archive-analysis plan (about 206,580 historical posts were found across 4 sources). Cancelled by the owner. Scene Radar stays as it is, with batch drafting added instead. The design document exists as a Claude artifact; nothing was built.
