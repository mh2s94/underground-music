# UNDERGROUND — Independent Extreme Music Magazine

**https://music.mikasa.me**: news, reviews, Basement radio (music library), charts and band profiles for the heavy underground scene (metalcore, deathcore, hardcore, black metal and about 415 related genres). The look is "Neon Basement": dark, neon pink `#FF2E63` + UV `#7B5CFF`, Bebas Neue / Inter / Space Mono.

| | |
| --- | --- |
| Repository | `mh2s94/underground-music` (GitHub) |
| Production branch | `main` (every push deploys) |
| Hosting | Cloudflare Pages project `underground-music`, no build step, output = repo root |
| Server code | Cloudflare Pages Functions (`functions/`) |
| Database / auth | Supabase project `lhhmzfwjznlwkentbakv` (Singapore): Postgres + RLS, Auth with TOTP 2FA |
| Music files | Cloudflare R2 (binding `MUSIC`), Supabase Storage fallback |
| AI | Workers AI (binding `AI`) + optional Gemini, Groq, OpenRouter, Mistral, DeepSeek, OpenAI, Anthropic |
| Email | Resend (newsletter), Cloudflare Email Routing (`hello@mikasa.me`) |
| Automation | GitHub Actions (daily AI drafts) |

> **New here (human or AI)? Read [docs/DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md) first.** It has the permanent rules: never disable RLS, 2FA or the CSP as a workaround; never expose secrets; document every change. Then check [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) for what is verified, what is unverified, and what is pending.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, frontend, routing, every API route, data flows (auth, admin, AI, music, Scene Radar, jobs, newsletter, charts, band pages) |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, columns, relations, functions, triggers, RLS + MFA model, SQL order, the 2026-11-17 RLS incident, verification queries |
| [docs/SECURITY.md](docs/SECURITY.md) | Accounts, admin membership, 2FA, admin page protection, headers/CSP/HSTS, Turnstile, rate limits, secrets |
| [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) | Providers, models, hedged fallback, timeouts, Auto-write, batch drafts, scheduled drafts, music metadata, adding a provider |
| [docs/MUSIC-SYSTEM.md](docs/MUSIC-SYSTEM.md) | Upload limits, R2 vs Supabase, chunked upload, streaming, tags, player, charts and ratings |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Pages settings, bindings, **all environment variables**, DNS and email, redeploy, GitHub Actions |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Real problems and how to diagnose them safely |
| [docs/DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md) | Rules, owner preferences, workflow, conventions, release checklist |
| [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) | Feature and security status, owner to-dos, known issues, tests done, next checks |

## Repository map

```
index.html            Public site shell: all views (home, articles, music, charts, about, account, band),
                      player markup, search overlay, footer/newsletter, JSON-LD, old-domain redirect.
admin.html            Admin panel (one file, inline script): 2FA gate, AI generator, article form,
                      Scene Radar (single + batch drafts), article list + "Publish all", demo inbox,
                      Music upload/auto-fill/covers, Settings (Security check, clean-up, newsletter).
privacy.html, terms.html   Legal pages (UU PDP rights, Resend, analytics, self-deletion).
_headers              Security headers for static files: CSP, HSTS, X-Frame-Options, etc.
robots.txt            Disallows /admin.html and /api/, links the sitemap.
manifest.webmanifest  PWA manifest (icons in assets/).

assets/
  bento.js            The whole public app: config, routing, data loading, rendering, accounts,
                      comments, saves, demos, player, charts, ratings, search, newsletter, band pages,
                      Turnstile hook. Uses supabase-js from cdn.jsdelivr.net.
  bento.css           Main theme and layout.   account.css  Account page (Amp Head, rack slide).
  launch.js/.css      Launch motion "09 Mosh Pit" (first open + short version on view change).
  ui.js / ui.css      window.UI: esc() HTML-escaping, toast() notifications.
  genres.js           window.UG_GENRES: 30 groups / ~415 genres (must match functions/api/genres-data.js).
  audiotags.js        window.readAudioTags(file): ID3, FLAC and MP4 tags + embedded cover, in the browser.
  favicon.svg, *.png  Icons and the default share image (og.png).

functions/            Cloudflare Pages Functions (file path = URL route)
  a/[slug].js         /a/<slug>: index.html with the article's meta tags + JSON-LD (SEO, link previews).
  band/[slug].js      /band/<slug>: same for band profiles.
  sitemap.xml.js      /sitemap.xml
  unsubscribe.js      /unsubscribe?t=<token> (GET page, POST one-click)
  api/news.js         Scene Radar: RSS aggregator (7 sources), 15 min cache.
  api/generate.js     AI article generator (admin + 2FA); exports buildProviders/writeArticle.
  api/auto-draft.js   Daily AI drafts (token from GitHub Actions; uses the Supabase secret key).
  api/track-info.js   Music metadata: iTunes/Deezer lookup + AI clean-up (admin + 2FA).
  api/music/[[path]].js  R2 upload (single + multipart), streaming with Range, delete, purge.
  api/charts.js       Global charts from Deezer (by group/genre), 6 h cache.
  api/preview.js      Redirect to a fresh Deezer 30 s preview.
  api/cover.js        Artwork lookup (iTunes/Deezer), 7 day cache.
  api/band.js         Deezer artist data for band pages, 24 h cache.
  api/newsletter/send.js  Newsletter via Resend (admin + 2FA).
  api/aal.js          isAal2(): 2FA check shared by admin routes.
  api/genres-data.js  Server copy of the genre taxonomy (PROMPT_LIST, canonicalGenre).

supabase/             SQL to run in the Supabase SQL Editor (idempotent; order in docs/DATABASE.md)
  community.sql  music.sql  music-v2.sql  charts.sql  extras.sql  security.sql  security-check.sql

.github/workflows/auto-draft.yml   Daily 21:43 UTC (06:43 WIT) POST /api/auto-draft.
docs/                 This documentation.
```

The base tables `articles`, `categories` and `admin_users` were created in the Supabase dashboard and are **not** in `supabase/`. See [docs/DATABASE.md](docs/DATABASE.md).

## Features

| Feature | Summary | Details |
| --- | --- | --- |
| Articles | Markdown articles with genre, tags, cover, YouTube embed, review score and verdict; pages at `/a/<slug>` | [ARCHITECTURE §2](docs/ARCHITECTURE.md#2-frontend) |
| Admin newsroom | AI generator fills every field; Draft / Review / Publish; publish time can follow the source | [AI-SYSTEM](docs/AI-SYSTEM.md) |
| Scene Radar | Headlines from 6 working RSS sources; public "Underground wire"; admin Auto-write, batch of up to 5 drafts, Publish all | [ARCHITECTURE §3.7](docs/ARCHITECTURE.md#37-scene-radar) |
| AI drafts | Daily 2 drafts at 06:43 WIT; never auto-published | [AI-SYSTEM](docs/AI-SYSTEM.md#scheduled-ai-drafts-post-apiauto-draft) |
| Community accounts | Email sign-up with confirmation, profile with favourite genres, password reset, self-deletion | [SECURITY](docs/SECURITY.md#visitor-accounts) |
| Comments / saved articles | On published articles; 5 comments per minute per member | [DATABASE](docs/DATABASE.md#2-tables) |
| Demo submissions | Members send links (3 per day); admin Demo inbox with status | [DATABASE](docs/DATABASE.md#demo_submissions-communitysql) |
| Music library (Basement radio) | Upload with tag auto-fill and covers; persistent player; Now Playing; lock-screen controls | [MUSIC-SYSTEM](docs/MUSIC-SYSTEM.md) |
| Charts | Community (star ratings, Bayesian) and Global (Deezer) Top 10 bands and hits, by genre group or sub-genre, playable previews | [MUSIC-SYSTEM](docs/MUSIC-SYSTEM.md#charts-and-ratings) |
| Band profiles | `/band/<slug>`: stories, tracks, review average, members' rating, Deezer fans, top tracks, related bands | [ARCHITECTURE §3.11](docs/ARCHITECTURE.md#311-band-profiles) |
| Newsletter | Sign-up anywhere; admin composes from stories and sends via Resend; one-click unsubscribe | [ARCHITECTURE §3.9](docs/ARCHITECTURE.md#39-newsletter) |
| Search and genre filters | `/` or Ctrl+K: stories, songs, genres; genre pills; `?q=` links | [ARCHITECTURE §2](docs/ARCHITECTURE.md#2-frontend) |
| Gigs / calendar | **Removed** at the owner's request (unused `gigs` table remains) | [ARCHITECTURE §3.12](docs/ARCHITECTURE.md#312-gigs) |
| Security | RLS everywhere, admin 2FA (TOTP, `aal2`) in panel + API + DB, CSP/HSTS, Security check | [SECURITY](docs/SECURITY.md) |

Verification status of each feature: [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md).

## Setting up from scratch (summary)
Full details are in the linked documents. The order matters.

1. **Supabase project.**
   - Create the base tables `articles`, `categories`, `admin_users` with RLS (see [DATABASE.md](docs/DATABASE.md#2-tables) for the columns the code needs).
   - Run `community.sql` → `music.sql` → `music-v2.sql` → `charts.sql` → `extras.sql`.
   - Auth: Email provider with Confirm email on. Site URL `https://music.mikasa.me`, Redirect URL `https://music.mikasa.me/**`. MFA TOTP enabled.
2. **Cloudflare Pages.**
   - Connect the repo: no build command, output `.`.
   - Add `SUPABASE_URL` and `SUPABASE_ANON_KEY`, the Workers AI binding `AI`, and optionally the R2 binding `MUSIC` and provider keys ([DEPLOYMENT.md](docs/DEPLOYMENT.md#environment-variables)).
   - Add the custom domain `music.mikasa.me`.
3. **Admin.**
   - Sign up on the site, then `insert into admin_users (user_id) values ('<uuid>')`.
   - Open **Account → Admin panel** and enrol 2FA.
   - Then run `security.sql` and `security-check.sql`.
   - Then make sure admins can read drafts: add the "Admins can read all articles" SELECT policy ([DATABASE.md §6](docs/DATABASE.md#6-incident-insert-returning-blocked-by-rls-2026-11-17)).
4. **Optional.**
   - Resend (`RESEND_API_KEY`, `NEWSLETTER_FROM`).
   - Daily drafts (`AUTODRAFT_TOKEN` in Cloudflare **and** GitHub, plus the Supabase secret key in Cloudflare).
   - Turnstile, a rate-limiting rule, DMARC.
5. **Verify.** Run the release checklist in [DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md#testing-checklist-for-releases).

## Owner contact and preferences
- Contact: `hello@mikasa.me`.
- The owner communicates in Indonesian and prefers seeing options or previews before design changes. See [DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md#owner-preferences-from-the-project-history).
