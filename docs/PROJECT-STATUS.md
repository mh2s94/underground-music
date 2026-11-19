# Project status

Last audit: **2026-11-19**, against `main` @ `82afca0` (Final Audit). Update this file with every change.

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
| Scheduled AI drafts | REMOVED | Removed in PR #58 on 2026-11-19; AI generation is manual only |
| RSS news publisher | IMPLEMENTED, NOT VERIFIED | PR branch `feat/rss-news-publisher`; short English RSS briefs, no AI, max 3/run and 10/day; SQL and secrets still require owner setup after PR approval |
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
| Theme engine Tahap 1 (tokens, schema/sanitizer, `UGTheme` runtime with fallback, `window.UG` contract, regions) | IMPLEMENTED, merged (PR #48) | no visual change |
| Theme Tahap 2: `supabase/themes.sql` (tables, RLS, `ug_active_theme`, `ug_apply_theme`, `ug_restore_theme`, `ug_reset_theme`, history) | VERIFIED | applied by owner 2026-11-18; local: 49 SQL tests, parity 273 inputs, concurrency, re-run safe |
| Theme Manager (PR #49): edge middleware, `/api/theme/refresh`, catalogue of 11 themes, preview in new tab, save draft, Apply, Restore, Reset, history | VERIFIED | owner tested all actions on production 2026-11-18; E2E 71/71 desktop + HP; Preview check on the deployment |
| Theme edge resilience (PR #50): 2 s RPC timeout, last valid theme on failure (`;stale`), Neon Bento only when none was ever read | VERIFIED | 48 edge tests (CI); production `neon-bento@5;rpc`/`;cache` from Indonesia, DFW and ARN on 2026-11-18 |
| Themes 01–10 (Tahap 4): Front Page, The Pit, Setlist, Mosh Grid, Control Room 2.0, Main Stage, Xerox Zine, Index, Frequency, Scene Atlas | IMPLEMENTED, preview only | branch `themes-01-10`; all `ready`; tests: themes 12, edge 51, browser check 272 (every theme × desktop/phone × every view), Theme Manager E2E 44 (preview, apply, persistence after reload, restore, reset), Neon Bento pixel diff 0 (except the phone genre filter, below). Owner ACC 2026-11-19 |
| Phone: genre filters on Articles and Music as one sideways-scrolling row (all themes, incl. Neon Bento) | IMPLEMENTED | owner request 2026-11-19 (30+ genre buttons filled the screen); 26 genres → one 46 px row, no page overflow |
| supabase-js pinned to 2.119.0 with SRI (`index.html`, `admin.html`) | IMPLEMENTED (this PR) | same file that `@2` served on 2026-11-19; hash checked in CI (`tests/supabase-js-pin.test.mjs`) and in a browser on the preview |
| Production smoke test every 6 h (`smoke-production.yml`, read-only) | IMPLEMENTED (this PR) | first scheduled run after merge |
| Hero drummer video (C · beside buttons, neon tint, full 5 s loop; `assets/media/hero-drummer.mp4` 294 KB, Kling AI clip supplied by owner, watermark kept) | IMPLEMENTED | owner ACC 2026-11-18; loads only on screen, never for reduced motion / Save-Data |
| Telegram bot: information-only radar digest 3x a day | VERIFIED live 2026-11-18 (owner screenshot); draft/publish buttons removed in PR #58 | SQL, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` set by owner |
| Footer "Where our readers are" (style B strip, `/api/readers`) | VERIFIED | live on music.mikasa.me (owner screenshot 2026-11-17) |
| Google Search Console | VERIFIED (ownership) / PENDING (indexing) | |

## Security

| Item | Status | Evidence / notes |
| --- | --- | --- |
| RLS on articles and admin_users | VERIFIED | owner checked policies |
| Admin 2FA (panel, API, DB) | VERIFIED | owner enrolled; `security.sql` applied; Security check shows aal2 |
| "Admins can read all articles" SELECT policy | VERIFIED live / PENDING in repo | created in dashboard; its SQL must be copied into `supabase/` |
| Admin page hidden from visitors | VERIFIED | E2E (guest, member, admin without 2FA); admin APIs answer 401 without login on production |
| CSP + HSTS headers | VERIFIED | production checks 2026-11-18: CSP identical to `_headers`, HSTS, DENY, nosniff on HTML and static files |
| Turnstile captcha | PENDING | owner must create a widget and send the **site key** |
| Cloudflare rate-limiting rule for `/api/*` | PENDING | owner action (steps in SECURITY.md) |
| Rotate `AUTODRAFT_TOKEN` | PENDING | the old value appeared in a chat transcript |
| DMARC record | PENDING confirmation | recommended value in DEPLOYMENT.md |

## Waiting for the owner
In the order of the Final Audit (2026-11-19):

1. Rotate `AUTODRAFT_TOKEN` in Cloudflare **and** GitHub, then redeploy.
2. Run the read-only base-schema export in [DATABASE.md §7](DATABASE.md#export-the-base-schema-for-supabasebasesql) and send the result. It becomes `supabase/base.sql` (includes the "Admins can read all articles" policy).
3. Production checklist with one test member account (sign up, sign in, comment, save, demo, newsletter + unsubscribe, delete account) and, as admin with 2FA, R2 upload, Scene Radar batch, one Telegram button.
4. Turnstile: create the widget, send the site key, then add the secret key in Supabase **after** the code is deployed.
5. Cloudflare rate-limiting rule for `/api/*` (do not enable Bot Fight Mode).

Optional decisions (not needed to finish the project):

6. Decide whether to replace or remove New Noise in Scene Radar.
7. Decide whether to move the site into a `public/` folder so docs and SQL are no longer downloadable (see below).
8. Delete leftover GitHub branches (`radar-audit` and merged feature branches).

Done:

- ~~Add `CF_ACCOUNT_ID` (plain) and `CF_ANALYTICS_TOKEN` (secret, "Account Analytics: Read") to Pages Production variables, then redeploy, for the footer readers box.~~ Done 2026-11-17.
- ~~Telegram bot: run `supabase/telegram.sql`; create the bot in @BotFather; add `TELEGRAM_BOT_TOKEN` (secret); run the "Telegram radar digest" workflow; send `/start`; add `TELEGRAM_CHAT_ID`; redeploy.~~ Done 2026-11-18.

## Known issues and risks
- **Repo root is the public output directory.** `README.md`, `docs/*` and `supabase/*.sql` are downloadable from the site. They hold no secrets but reveal the architecture. Fix: move the site files into `public/` and change the Pages output directory. Needs approval.
- **The base schema is not in the repo:** `articles`, `categories` and `admin_users` were created in the dashboard. Their columns in DATABASE.md are inferred from the code. Export the real definitions when possible.
- **New Noise** RSS blocked by captcha.
- **The charts header comment** in `functions/api/charts.js` still describes the old genre-artist method as the default. The code uses Metal playlists first. The comment is stale; the behaviour is correct.
- **The old admin login form** in `admin.html` is unused (sign-in now happens on the Account page).
- **Model defaults** in `generate.js` (for example `gemini-3.8-flash`, `gpt-6-astra`) are not verified against each vendor's current model list.

## Final Audit (2026-11-19, `main` @ `82afca0`)
Status: READY WITH MINOR ISSUES. Evidence, all automated unless noted:
- Syntax of every JS file and import of all 24 Pages Functions: no errors.
- Theme edge tests 48/48, E2E 71/71 (desktop + phone, emulator with the real SQL), theme runtime 30/30, schema 16/16, theme SQL 49/49, validator parity identical.
- All 9 SQL files applied in order to an empty PostgreSQL 16 database (with a stand-in for the dashboard tables) and re-run: no errors. RLS on in 15/15 tables; 46/46 access probes (visitor, member, admin without 2FA, admin with 2FA); all 19 SECURITY DEFINER functions have a fixed `search_path`.
- Accessibility/layout scan of 6 views at 1280 and 390 px: no image without alt, no unnamed control, no unlabeled input, no horizontal overflow.
- Production (2026-11-18): headers, APIs and theme checked from DFW and ARN (70/71, the one miss is Cloudflare's managed `robots.txt` prefix); owner confirmed `neon-bento@5;rpc` from Indonesia.
- Scheduled workflows: auto-draft and Telegram digest succeeded on every scheduled run of 17–18 Nov.
- Not verified live: member flows (accounts, comments, saves, demos, newsletter, unsubscribe, account deletion), music upload, Scene Radar batch, Telegram buttons.

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
- Owner checklist (item 3 of "Waiting for the owner"): member flows, R2 upload, Scene Radar batch, Telegram button.
- First scheduled runs of "Production smoke test" are green.

## Cancelled
- **RADAR Intelligence / ALL POSTS SCAN** (2026-11-17): a large archive-analysis plan (about 206,580 historical posts were found across 4 sources). Cancelled by the owner. Scene Radar stays as it is, with batch drafting added instead. The design document exists as a Claude artifact; nothing was built.

## 2026-11-19 · Scheduled AI removed
At the owner's request, to save AI quota: the daily AI drafts (`auto-draft.yml`, `/api/auto-draft`), the Telegram
Tulis draft / Publish / Buang buttons and the Scene Radar autopilot (#55, #56) were removed. The Telegram digest
stays as information only and no longer uses AI to score headlines. The admin generator and Auto-write still work,
only when pressed.
