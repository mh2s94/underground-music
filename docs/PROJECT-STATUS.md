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
| VPS AI auto-publisher (`POST /api/ai-publish`, `ai_ingestion`, tests/docs) | IMPLEMENTED, NOT VERIFIED | Hardening migration applied and RLS verified 2026-11-20; media fields PR adds `cover_image_url` + `youtube_video_id` support; apply media migration before deploying; endpoint secrets/VPS smoke test remain owner actions |
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
| Theme Manager (PR #49): edge middleware, `/api/theme/refresh`, theme catalogue (11 then; **Monochrome Modular only** since PR #69), preview in new tab, save draft, Apply, Restore, Reset, history | VERIFIED | owner tested all actions on production 2026-11-18; E2E 71/71 desktop + HP; Preview check on the deployment |
| Theme edge resilience (PR #50): 2 s RPC timeout, last valid theme on failure (`;stale`), the default theme only when none was ever read | VERIFIED | 48 edge tests (CI); production `neon-bento@5;rpc`/`;cache` from Indonesia, DFW and ARN on 2026-11-18 |
| Themes 01–10 (Tahap 4): Front Page, The Pit, Setlist, Mosh Grid, Control Room 2.0, Main Stage, Xerox Zine, Index, Frequency, Scene Atlas | DROPPED 2026-11-24 | preview only, never merged; the owner settled on the current theme (**Monochrome Modular**), so branch `themes-01-10` and the other theme experiments were deleted (see the 2026-11-24 entry) |
| Phone: genre filters on Articles and Music as one sideways-scrolling row (all themes, incl. the default) | IMPLEMENTED | owner request 2026-11-19 (30+ genre buttons filled the screen); 26 genres → one 46 px row, no page overflow |
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
| CSP + HSTS headers | VERIFIED | production 2026-11-18 checks the current `'unsafe-inline'` CSP, HSTS, DENY, nosniff on HTML and static files. The new hash-based CSP is **live and browser-verified on production 2026-11-23** (see the latest security entry) |
| Turnstile captcha | PENDING | owner must create a widget and send the **site key** |
| Cloudflare rate-limiting rule for `/api/*` | IMPLEMENTED (owner) | set in the Cloudflare dashboard; excludes `/api/ai-publish`, `/api/news-publish` and `/api/telegram/*` (autopilot). Expression and steps in SECURITY.md |
| Rotate `AUTODRAFT_TOKEN` | PENDING | the old value appeared in a chat transcript |
| DMARC record | PENDING confirmation | recommended value in DEPLOYMENT.md |

## Waiting for the owner
In the order of the Final Audit (2026-11-19):

1. Rotate `AUTODRAFT_TOKEN` in Cloudflare **and** GitHub, then redeploy.
2. Run the read-only base-schema export in [DATABASE.md §7](DATABASE.md#export-the-base-schema-for-supabasebasesql) and send the result. It becomes `supabase/base.sql` (includes the "Admins can read all articles" policy).
3. Production checklist with one test member account (sign up, sign in, comment, save, demo, newsletter + unsubscribe, delete account) and, as admin with 2FA, R2 upload, Scene Radar batch, one Telegram button.
4. Turnstile: create the widget, send the site key, then add the secret key in Supabase **after** the code is deployed.
5. ~~Cloudflare rate-limiting rule for `/api/*`~~ — **done**: the owner set the rule (it must exclude the autopilot; expression in [SECURITY.md](SECURITY.md)). Do not enable Bot Fight Mode.

Optional decisions (not needed to finish the project):

6. Decide whether to replace or remove New Noise in Scene Radar.
7. Decide whether to move the site into a `public/` folder so docs and SQL are no longer downloadable (see below).
8. ~~Delete leftover GitHub branches (`radar-audit` and merged feature branches).~~ **Done 2026-11-24** — every branch whose PR was already merged, plus `radar-audit` (53 branches), is gone; the 7 that remain are listed in the 2026-11-24 entry.

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

## 2026-11-19 · Bug fixes (`tests/bugfixes.test.mjs`, 19 checks, in CI)
- **Unsubscribe** (`functions/unsubscribe.js`): opening the link no longer unsubscribes (email scanners open every link). GET shows an "Unsubscribe" button; POST unsubscribes. One-click unsubscribe from email apps (`List-Unsubscribe=One-Click`) still works.
- **Newsletter retry** (`functions/api/newsletter/send.js`): every batch of a real send carries a Resend `Idempotency-Key` built from subject, intro, stories and recipients, so pressing Send again after a partial failure (within 24 h) does not email the same people twice. Test sends have no key. A JSON body of `null` is now a 400.
- **Broken `%` in addresses** (`/a/%E0`, `/band/abc%`): no longer crash the router in `assets/bento.js` or the page functions `functions/a/[slug].js` and `functions/band/[slug].js`.
- **Readers box** (`functions/api/readers.js`): country shares always add up to exactly 100 % (largest remainder rounding).
- **Unknown bands** (`functions/band/[slug].js`): answer 404 when Deezer answered and has no such artist and the site has no published story or song for it. The page still renders; any error or timeout keeps 200.
- **Markdown links**: a `*` inside a link address no longer turns into `<em>` inside the `href`.
- `bento.js` cache-bust bumped to `?v=bf1`.
- Status: IMPLEMENTED, NOT VERIFIED live (mock-tested).
- **Newsletter sign-up was broken for everyone** ("violates check constraint newsletter_subscribers_email_check"): the live constraint had doubled backslashes, so it demanded a literal `\` in every address (0 subscribers had ever been saved). Fixed live on 2026-11-19 (migration `fix_newsletter_email_check`, checked: valid address accepted, invalid rejected) and the repair is in `supabase/extras.sql`. VERIFIED in the database; sign-up from the site to be confirmed by the owner.

## 2026-11-23 · Security hardening: music CORS, article error, hash-based CSP, rate-limit guidance
Follow-up to the security review, chosen so the autopilot (VPS AI publisher + RSS) is untouched.

- **Music files** (`functions/api/music/[[path]].js`): `Access-Control-Allow-Origin` changed from `*`
  to the site's own origin — a fixed value, never the request Origin, so a cached response can never
  hand the header to a foreign origin. Same-origin playback and `<audio>` embeds are unaffected. The
  objects are cached at the edge for a year, so files cached before the deploy kept the old `*` until the
  owner **purged the Cloudflare cache on 2026-11-24**; re-checked live the same day, 5 audio and 5 cover
  files, cache hits included, all return `https://music.mikasa.me`.
- **Article pages** (`functions/a/[slug].js`): the 502 body no longer echoes the raw Supabase error
  (which could reveal table and column names); the detail still goes to the worker log.
- **CSP** (`_headers` + `functions/api/theme/edge.js`): `script-src` no longer uses `'unsafe-inline'`.
  It now allows the site's own inline scripts by SHA-256 hash and its two inline `onerror` handlers via
  `'unsafe-hashes'`. `style-src` keeps `'unsafe-inline'` on purpose: the theme middleware injects a
  per-request `<style>` (`functions/api/theme/edge.js`) and the pages use `style="…"` attributes. New
  `tests/csp.test.mjs` recomputes every hash from the files and runs in the preview check, so editing an
  inline script fails the build instead of the browser silently blocking it.
  - **The hashes must be single-quoted** (`'sha256-…'`). The first version wrote them bare, and headless
    Chromium reported every one as *"invalid source … will be ignored"*: the browser dropped the hashes
    and blocked the very inline scripts they were meant to allow. Fixed in both files; the guard test now
    also rejects an unquoted hash.
- **Rate limiting** (IMPLEMENTED, owner-configured): the Cloudflare rule covers the public `/api/` surface
  but **excludes** `/api/ai-publish`, `/api/news-publish` and `/api/telegram/*` — the autopilot — which is
  already token-protected and daily-capped, so an IP limit there would only risk breaking it. Not confirmed
  by an external test (a 130-request burst on 2026-11-23 was not blocked); the exact expression is in
  SECURITY.md.
- Status: **LIVE on production 2026-11-23** (squash merge of PR #84). All test suites pass. Browser-checked
  in headless Chromium the same day, first on the branch preview and then on `music.mikasa.me`: the CSP is
  served on `/`, `/admin`, `/search`, a band page and an article, `supabase-js` loads, the pages render,
  and no CSP violation is logged. The site's look is unchanged (the theme redesign stayed on its own branch).
- Closed out 2026-11-24: the Cloudflare rate-limit rule is in place, and the owner purged the cache, so the
  music CORS change now applies to the files that were already cached. The theme redesign was dropped by the
  owner (the current look stays; drafts #82 and #83 closed).

## 2026-11-24 · Theme settled; theme, appearance and merged branches removed
**Theme settled.** The owner confirmed the site keeps its current theme (**Monochrome Modular**), so no
further redesign work is planned. Drafts #82 (LIVE SIGNAL) and #83 (visual overhaul + the security work,
which shipped separately in #84) were closed, and the theme/appearance branches were deleted on GitHub:

`theme-engine`, `theme-foundation`, `theme-edge-resilience`, `themes-01-10`, `theme/live-signal-polish`,
`fix/theme-font-parity`, `redesign/bento-dashboard`, `redesign/editorial-ui`, `redesign/neon-basement`,
`visual-fx`, `visual-v2`, `account-skins`, `launch-motion`, `hero-drop`, `hero-video`, `main-stage-phone`,
`footer-readers`, `feat/footer`, `featured-fill`, `fix/glitch-wave-branding-all-pages`,
`fix/glitch-wave-header-favicon-cache` — 21 remote branches, plus the local `feat/visual-overhaul`.

**Merged branches cleaned up (item 8).** Every branch whose PR was already merged was deleted, plus
`radar-audit` — 53 branches in one push. The repository now holds 7: `main`, `final-foundation`, and five that
were **never merged**: `feat/ai-publish-hardening-v2`, `feat/basement-radio-trim`,
`fix/autopilot-checker-omissions`, `fix/remaining-cleanup` and `public-dir` (item 7).

**README made to match.** The "look" paragraph described a dropped theme ("Neon Basement", neon pink
`#FF2E63` + UV `#7B5CFF`, "Neon Bento", "ten more site themes"). It now describes **Monochrome Modular** —
industrial black, white and grayscale, no neon — and says it is the only theme. The same stale name was fixed
in ARCHITECTURE.md (two rows), TROUBLESHOOTING.md (two spots) and the Theme Manager rows here.
`assets/bento.css` still carries it in a header comment (a code file, left untouched).

- `final-foundation` was **kept** on purpose: it is infrastructure/docs (supabase-js pin + SRI, smoke test,
  docs), not appearance.
- Deleting a branch only drops the pointer; anything already in `main` is unaffected. The 53 merged branches
  are recoverable from their merged pull requests (GitHub keeps `refs/pull/<n>/head`).

<details>
<summary>Deleted branch tips (for recovery)</summary>

```
theme-engine                         1e50be3768a49add88a9a83c9f998b0f40c39e71
theme-foundation                     99981f315856051a50d5900ecb7cdeb493bc7deb
theme-edge-resilience                ea69c99a218a663e3809660f09207916a267cbd5
themes-01-10                         1790ad4e419d13c57c70857d9095a02cdb150024
theme/live-signal-polish             194f85e75ce61a3578d56d3975a80ffbca2e4136
fix/theme-font-parity                f17e94ae72c8104238a83d464c6e0ec355ac3056
redesign/bento-dashboard             d522466ebf493ad5fea1e58010391123b5c49148
redesign/editorial-ui                a63d85fa7a844dfc9b09d7198c79cc178c1af5ce
redesign/neon-basement               549cfda03541538ebc60aaf60d53877ae4c1ffe2
visual-fx                            8a79cb99e0819c518c401737593fe93bea761c85
visual-v2                            754f7a17366e369b16277b788f3b614622fbe28d
account-skins                        402dbc5f3be2084150035b8490e0f41049700f9a
launch-motion                        c2e0db6f4373062bd8b8030bc83b0c133299aa25
hero-drop                            d734c0056c6ed5df16a36387efebc649c76f53f9
hero-video                           5ac9583d8c5e58b9bfb450cd15d60108b1607aaa
main-stage-phone                     8cd9cd3a506342ae694b4d808a88526fb71205f9
footer-readers                       ec1eeb6912243a9b405902b787ed07e777c9e6e6
feat/footer                          690471930c20de0a5c549efb40b3769f64e9516e
featured-fill                        2875fed19f525a246d434a1299e4c52d95ac6e7d
fix/glitch-wave-branding-all-pages   cbc95b436f6caa94c2deca3ec0561e2b804ba874
fix/glitch-wave-header-favicon-cache 02dfa0aea4d4f36c25cf1ecd5351ea8a7b148297
feat/visual-overhaul (local only)    645cabb
radar-audit (no PR)                  04fa8a15250f8dd21c6d9d869e0c65fe987655e2
```

</details>
