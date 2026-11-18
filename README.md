# UNDERGROUND — Independent Extreme Music Magazine

**https://music.mikasa.me** is an independent online magazine for the heavy underground scene: metalcore,
deathcore, hardcore, black and death metal and about 415 related genres. It publishes news, reviews and
features, runs a music library ("Basement radio") with a persistent player, community and global charts, band
profiles, a newsletter, and a small community of members who comment, save stories and send demos.

The look is "Neon Basement": dark background, neon pink `#FF2E63` + UV `#7B5CFF`, Bebas Neue / Inter / Space Mono,
in a bento-grid layout called **Neon Bento**. That is the default theme; ten more site themes (Front Page,
The Pit, Setlist, Mosh Grid, Control Room 2.0, Main Stage, Xerox Zine, Index, Frequency, Scene Atlas) can be
applied from the admin Theme Manager ([THEMES.md](docs/THEMES.md#catalogue-11-themes)).

> **New here (human or AI)?** Read this file, then [docs/DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md) (the
> permanent rules), then [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) (what is verified, unverified and
> pending). Never disable RLS, 2FA, the CSP or HSTS as a workaround, never expose a secret, and document every change.

| | |
| --- | --- |
| Repository | `mh2s94/underground-music` (GitHub), production branch `main` |
| Hosting | Cloudflare Pages project `underground-music`, custom domain `music.mikasa.me` |
| Server code | Cloudflare Pages Functions (`functions/`) + one middleware |
| Database / auth | Supabase (Singapore): PostgreSQL + RLS, Auth with email + TOTP 2FA, Storage |
| Music files | Cloudflare R2 (binding `MUSIC`), Supabase Storage for small files |
| Status | In production. Final Audit 2026-11-19: *ready with minor issues* ([details](docs/PROJECT-STATUS.md)) |

---

## 1. Project overview

**Who it is for.** Readers and bands of the extreme-music underground, written in English, run by one owner/editor
(Indonesia, WIT). The editor works from the admin panel and from a Telegram bot; AI helps write drafts but
**never publishes on its own**.

**Main features** (status of each: [PROJECT-STATUS.md](docs/PROJECT-STATUS.md)):

| Area | What it does |
| --- | --- |
| Articles | Markdown stories with genre, tags, cover, YouTube embed, review score; own page `/a/<slug>` with SEO meta + JSON-LD |
| Admin newsroom | AI generator fills every field; Draft / Review / Publish; demo inbox; music upload; Settings |
| Scene Radar | Headlines from 7 RSS sources (6 working) as a public "Underground wire"; admin Auto-write and batch drafts |
| AI drafts | 2 drafts every morning (06:43 WIT) from fresh headlines, saved as drafts only |
| Telegram Radar | Digest of relevant headlines 3× a day (08:07, 14:07, 20:07 WIT) with buttons: write draft, publish draft, discard |
| Music library | Upload with tag auto-fill and covers, persistent player, Now Playing, lock-screen controls |
| Charts | Community (members' star ratings) and Global (Deezer) Top 10 bands and tracks, playable 30 s previews |
| Band profiles | `/band/<slug>`: stories, tracks, ratings, Deezer data, related bands |
| Community | Accounts with email confirmation, profile, comments, saved stories, demo submissions, self-deletion |
| Newsletter | Sign-up, admin sends via Resend, one-click unsubscribe |
| Theme Manager | Admin switches between 11 complete site themes (layout + style) and adjusts colours/fonts for all visitors without a redeploy: preview in a new tab, Apply, Restore, Reset, history |
| Footer "Where our readers are" | Share of readers per country from Cloudflare Web Analytics |

Not available: gigs/calendar (removed),
captcha (Turnstile not configured yet).

## 2. Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | Static HTML + vanilla JavaScript, no build step, no framework. `index.html` + `assets/bento.js` (public single-page app), `admin.html` (admin panel, inline script), plain CSS |
| Client library | supabase-js **2.119.0**, from jsDelivr, pinned with Subresource Integrity |
| Hosting + edge | Cloudflare Pages (static files from the repo root) + Pages Functions (`functions/`, file path = URL) + `functions/_middleware.js` on every page |
| Database | Supabase PostgreSQL with Row Level Security on every table; SQL functions (`ug_*`) for privileged actions |
| Auth | Supabase Auth: email + password with confirmation; TOTP 2FA required for admins (`aal2`) |
| Files | Cloudflare R2 bucket `underground-music` (≤ 100 MB per file, chunked upload, Range streaming); Supabase Storage bucket `music` (≤ 25 MB) |
| AI | Provider chain in `functions/api/generate.js`, default order `gemini, workersai, groq, openrouter, mistral, deepseek, openai, claude` (`AI_PROVIDER_ORDER`). A provider is used only when its key or binding is set. Workers AI (binding `AI`) is verified in production; which other keys are set is not visible from the repo |
| External data | Deezer (charts, previews, artists), iTunes (covers, metadata), RSS feeds, YouTube |
| Email | Resend (newsletter), Cloudflare Email Routing (`hello@mikasa.me`) |
| Analytics | Cloudflare Web Analytics |
| Automation | GitHub Actions: daily AI drafts, Telegram digest, production smoke test every 6 h, preview check on every PR |

## 3. Architecture

```
Browser ──► Cloudflare (music.mikasa.me)
             ├─ /assets/*, robots.txt, manifest, favicon ─► static files (headers from _headers)
             ├─ pages (/, /privacy, /a/<slug>, /band/<slug>, …) ─► _middleware.js
             │     reads active theme (ug_active_theme, 30 s edge cache) ─► injects theme + security headers
             ├─ /api/* ─► Pages Functions ─► Supabase REST / R2 / AI providers / Deezer / Resend / Telegram
             └─ /admin ─► admin.html (headers only, never themed)
Browser ──► Supabase directly (supabase-js, publishable key): reads, sign-in, member writes — all under RLS
```

**Repository map**

```
index.html, admin.html, privacy.html, terms.html   Pages (public app, admin panel, legal)
_headers        Security headers for static files      _routes.json   Which URLs run Functions
robots.txt, manifest.webmanifest
assets/         bento.js (public app) · bento.css (design tokens + Neon Bento) · account.css · launch.* (intro motion)
                ui.* (escaping, toasts) · genres.js (taxonomy) · audiotags.js (ID3/FLAC/MP4 tags) · readers.js
  theme/        schema.js (theme catalogue + sanitizer, shared with the edge) · runtime.js (UGTheme)
                preview.js (admin draft preview) · manager.js/.css (Theme Manager)
  themes/<id>/  theme.css + shell.js of the ten themes 01–10 (Neon Bento needs no files)
functions/      _middleware.js · a/[slug].js · band/[slug].js · sitemap.xml.js · unsubscribe.js
  api/          generate · track-info · auto-draft · draft-lib · news · charts · preview · cover · band · readers
                newsletter/send · music/[[path]] · telegram/{digest,webhook,lib} · theme/{edge,refresh}
                aal.js (2FA check) · genres-data.js (server copy of the taxonomy)
supabase/       SQL migrations, run in the Supabase SQL editor in the order of docs/DATABASE.md
tests/          theme-edge.test.mjs (edge) · themes.test.mjs (catalogue + theme files) · supabase-js-pin.test.mjs (SRI)
.github/        workflows/ (auto-draft, telegram-digest, smoke-production, preview-check) · scripts/
docs/           Detailed documentation (table below)
```

**Main flows** (full diagrams: [ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **Public site.** `bento.js` loads published articles, tracks and charts from Supabase with the publishable
  key; RLS decides what is visible. Routes are client-side (`/articles`, `/music`, …); `/a/<slug>` and
  `/band/<slug>` are rendered by Functions with real meta tags for Google and link previews.
- **Admin panel.** Sign-in → admin membership (`admin_users`) → 2FA (`aal2`). The panel talks to Supabase
  directly for CRUD (RLS requires admin + `aal2`) and to admin Functions for AI, music upload, newsletter and
  theme refresh (each checks the token, `admin_users` and `aal2`).
- **Articles and AI.** Generator (`/api/generate`) tries providers in order with timeouts; output is saved as a
  draft by the admin. Scene Radar (`/api/news`) merges RSS feeds; the admin can turn headlines into drafts.
  Scheduled drafts (`/api/auto-draft`) and the Telegram bot use the server-side Supabase secret key and only
  ever create, publish or discard **drafts**.
- **Music.** Upload to R2 (chunked for large files) or Supabase Storage; `/api/music/file/…` streams with Range.
  Ratings and charts come from SQL functions in `charts.sql`; global charts from Deezer via `/api/charts`.
- **Community.** Members write comments, saves and demos straight to Supabase; RLS + triggers enforce ownership,
  published-only and rate limits (5 comments/min, 3 demos/day). `ug_delete_my_account()` deletes the member.
- **Theme Manager.** Admin saves drafts (`site_theme_configs`), previews them in a new tab, applies them
  (`ug_apply_theme`) → `/api/theme/refresh` clears the edge cache → every visitor sees it within 60 s. Restore
  and Reset write new versions to the history. If the database cannot be read, the edge serves the last valid
  theme, or Neon Bento ([THEMES.md](docs/THEMES.md)).

## 4. Security foundation

Details: [SECURITY.md](docs/SECURITY.md).

- **Three layers for admin power**: the panel (UI gate), every admin Function (`Authorization` token →
  `admin_users` → `aal2`), and the database (RLS policies and `ug_is_admin()` = listed in `admin_users`
  **and** JWT `aal = aal2`). The database layer is the one that matters.
- **Admin membership** is a row in `admin_users`, added by hand in the SQL editor. Admins must enrol TOTP 2FA.
- **RLS** is on for every table; members can only write their own rows; drafts are admin-only. Privileged
  actions run in `SECURITY DEFINER` functions with a fixed `search_path`.
- **Automation endpoints** use a shared token (`/api/auto-draft`, `/api/telegram/digest`, constant-time compare)
  or Telegram's secret header plus the owner's chat id (`/api/telegram/webhook`).
- **Security headers**: CSP, HSTS, `X-Frame-Options: DENY`, nosniff, referrer and permissions policy, COOP.
  Static files get them from `_headers`; HTML pages from the middleware (`SECURITY_HEADERS` in
  `functions/api/theme/edge.js`). **Change both together**; tests compare them.
- **supabase-js** is pinned with an SRI hash; a changed CDN file is blocked by the browser.
- **Secrets** live only in Cloudflare Pages (Production) and GitHub Actions secrets, never in the repo or browser.
  The Supabase URL and publishable key in the frontend are public by design.

## 5. Database foundation

Details, columns, functions and verification queries: [DATABASE.md](docs/DATABASE.md).

| Table | Purpose | Defined in |
| --- | --- | --- |
| `articles` | Stories (draft / review / published), review score | **dashboard, not in repo** + `extras.sql` (kind, score) |
| `categories` | Genre categories for articles | **dashboard, not in repo** |
| `admin_users` | Admin membership | **dashboard, not in repo** |
| `profiles` | Member profile (auto-created on sign-up) | `community.sql` |
| `comments`, `saved_articles`, `demo_submissions` | Community | `community.sql` |
| `tracks` | Music library | `music.sql`, `music-v2.sql`, `music-v3-trim.sql` |
| `track_ratings` | Members' star ratings | `charts.sql` |
| `newsletter_subscribers` | Newsletter list + unsubscribe token | `extras.sql` |
| `gigs` | Unused (feature removed) | `extras.sql` |
| `telegram_radar` | Telegram bot state (server key only) | `telegram.sql` |
| `site_theme_active`, `site_theme_configs`, `site_theme_history` | Theme Manager | `themes.sql` |

Important relations: `profiles.id` → `auth.users` (cascade); comments, saves and demos → `profiles` and `articles`
(cascade); `track_ratings` → `tracks` + `profiles`. Bands are matched by name, there is no `bands` table.

**Migrations** (all idempotent), in this order: *(0) base tables from the dashboard* → `community.sql` →
`music.sql` → `music-v2.sql` → `charts.sql` → `extras.sql` → `security.sql` → `security-check.sql` →
`telegram.sql` → `themes.sql`. All of them are applied in production. `music-v3-trim.sql` (Basement Radio cuts)
comes last and is **not applied yet**: the owner runs it after review.

**Rebuilding the database from the repo is not yet possible**, because step 0 is missing. Files 1–9 apply
cleanly (and re-run cleanly) on PostgreSQL 16 once those three tables exist. The read-only export query in
[DATABASE.md §7](docs/DATABASE.md#7-verifying-the-database) produces their exact definition; it will be saved as
`supabase/base.sql`.

## 6. Deployment and operations

Details: [DEPLOYMENT.md](docs/DEPLOYMENT.md) (every environment variable), [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

- **Production**: every push to `main` deploys (Cloudflare Pages Git integration, no build command, output
  directory = repository root, `_routes.json` keeps static files off Functions). Work goes through a branch and a
  pull request; the owner approves merges.
- **Previews**: every branch gets `https://<branch>.underground-music.pages.dev`. Previews lack production secrets
  (admin APIs answer "Server is not configured"), but read the production database with the public key.
- **Environment variables** (names only, values never in the repo): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `AUTODRAFT_TOKEN`, `RESEND_API_KEY`, `NEWSLETTER_FROM`, AI provider keys,
  `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; bindings `AI` and `MUSIC`.
- **GitHub Actions**:

  | Workflow | When | What |
  | --- | --- | --- |
  | `auto-draft.yml` | 06:43 WIT daily | 2 AI drafts from fresh headlines |
  | `telegram-digest.yml` | 08:07, 14:07, 20:07 WIT | Telegram digest of relevant headlines |
  | `smoke-production.yml` | every 6 h | Read-only checks of the live site; fails loudly with the reason |
  | `preview-check.yml` | every pull request | Unit tests, then 68 checks + a real-browser check on the preview deployment |

- **After a deploy**: the "Cloudflare Pages" check on the commit must be green; then
  `bash .github/scripts/smoke-production.sh` (or run the "Production smoke test" workflow). Quick header check:
  `curl -s -D - -o /dev/null https://music.mikasa.me/ | grep -i "x-ug-theme\|x-frame-options"`.

## 7. Development guide

1. **Read in this order**: this README → [DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md) →
   [PROJECT-STATUS.md](docs/PROJECT-STATUS.md) → [ARCHITECTURE.md](docs/ARCHITECTURE.md) →
   [SECURITY.md](docs/SECURITY.md) → [DATABASE.md](docs/DATABASE.md) → the topic doc you need.
2. **Run locally**: no install step. Serve the repo root (`python3 -m http.server`) for the static site;
   Functions are plain ES modules (`node --input-type=module -e "import('file://…/functions/api/x.js')"`).
3. **Tests**:
   - `node tests/theme-edge.test.mjs`: middleware, cache, theme fallback (no packages)
   - `node tests/themes.test.mjs`: theme catalogue, scoping, tokens and contrast, size budget, `ASSET_REV`
   - `node tests/supabase-js-pin.test.mjs`: pinned supabase-js and SRI hash (needs network)
   - `node .github/scripts/themes-check.mjs <url>`: every theme in a real browser (needs Playwright)
   - `bash .github/scripts/smoke-production.sh <url>`: read-only checks of any deployment
   - Pull requests run all of these plus checks on the preview deployment automatically.
4. **Change safely**: branch → PR → green checks → owner approval → squash merge → check production. Bump the
   `?v=` query of changed CSS/JS files. Keep `_headers` and `SECURITY_HEADERS` identical. SQL changes are new
   idempotent files or edits reviewed by the owner before they are run; never edit production data by hand.
5. **Never**: disable or loosen RLS, 2FA, CSP, HSTS or `X-Frame-Options`; put a secret in code, logs or chat; use
   the service key in the browser; let AI publish without the editor; re-introduce the old `ug_is_admin()` body
   without the `aal2` check.

## 8. Project status and maintenance

- **Verified in production**: public site and all views, security headers, admin 2FA gate, AI generator and
  daily drafts, Scene Radar, Telegram digest, global charts, readers footer, Theme Manager (Apply, Restore,
  Reset) and edge resilience.
- **Implemented, not yet verified live**: member flows (accounts, comments, saves, demos, newsletter sign-up,
  unsubscribe, self-deletion), music upload, Scene Radar batch, Telegram buttons. The SQL rules behind them pass
  automated access tests.
- **Pending (owner)**: rotate `AUTODRAFT_TOKEN`, export the base schema for `supabase/base.sql`, Turnstile site
  key, a Cloudflare rate-limit rule for `/api/*`.
- **Known limits**: repo files (docs, SQL) are publicly downloadable because the output
  directory is the repo root (no secrets in them); one Scene Radar source (New Noise) is blocked by a captcha.

**Recent milestones**

| Date | Change |
| --- | --- |
| 2026-11-19 | Themes 01–10 built and ready in the Theme Manager (PR pending owner ACC) |
| 2026-11-19 | Final Audit; supabase-js pinned with SRI; production smoke test; documentation brought up to date |
| 2026-11-18 | PR #50 theme edge resilience (2 s timeout, last valid theme) |
| 2026-11-18 | PR #49 Theme Manager + edge middleware; `themes.sql` applied |
| 2026-11-18 | PR #48 theme engine foundation; Telegram Radar; hero video |
| 2026-11-17 | Admin 2FA everywhere; readers footer; RLS INSERT RETURNING incident fixed |

**Staying stable**: keep the smoke test green, keep [PROJECT-STATUS.md](docs/PROJECT-STATUS.md) current with every
change, and use the [release checklist](docs/DEVELOPMENT-GUIDE.md#testing-checklist-for-releases).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, frontend, routing, every API route, data flows |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, columns, relations, functions, RLS + MFA model, SQL order, verification and export queries |
| [docs/SECURITY.md](docs/SECURITY.md) | Accounts, admin membership, 2FA, headers/CSP/HSTS, supabase-js SRI, Turnstile, rate limits, secrets |
| [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) | Providers, models, fallback, timeouts, Auto-write, batch and scheduled drafts |
| [docs/MUSIC-SYSTEM.md](docs/MUSIC-SYSTEM.md) | Upload limits, R2 vs Supabase, streaming, tags, player, charts and ratings |
| [docs/THEMES.md](docs/THEMES.md) | Theme engine, edge middleware, Theme Manager, how to build a theme |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Pages settings, bindings, environment variables, DNS and email, GitHub Actions |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Real problems and how to diagnose them safely |
| [docs/DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md) | Rules, owner preferences, workflow, conventions, release checklist |
| [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) | Feature and security status, owner to-dos, known issues, audits and tests |

Contact: `hello@mikasa.me`. The owner works in Indonesian and approves design changes from previews.
