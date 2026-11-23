# Authentication and security

Audited 2026-11-17. Labels: **VERIFIED** (checked live, by the owner or by CI), **IMPLEMENTED, NOT VERIFIED** (code exists and passed local or mock tests only), **PENDING** (needs configuration or an action).

## Summary

| Control | Where | Status |
| --- | --- | --- |
| Row Level Security on all app tables | Supabase | VERIFIED (owner, 2026-11-17) |
| Admin = row in `admin_users` | Supabase | VERIFIED |
| Admin 2FA (TOTP, `aal2`) in the panel | `admin.html` | VERIFIED (owner enrolled and verified) |
| Admin 2FA in API routes | `functions/api/aal.js` + 4 routes | VERIFIED indirectly (AI generation works with aal2) |
| Admin 2FA in the database | `supabase/security.sql` | VERIFIED (owner applied; Security check shows aal2) |
| "Admins can read all articles" select policy | Supabase dashboard only | VERIFIED live, **PENDING** in repo |
| `admin.html` hidden from non-admins | `admin.html` | IMPLEMENTED, NOT VERIFIED (mock-tested: guest, member, admin) |
| Security headers incl. CSP + HSTS | `_headers` (static) + `functions/api/theme/edge.js` (HTML pages) | VERIFIED live 2026-11-23 on production (headless Chromium: no CSP violation on `/`, `/admin`, `/search`, a band page and an article). `script-src` no longer uses `'unsafe-inline'` — it is hash-based and guarded by `tests/csp.test.mjs` |
| Cloudflare Turnstile captcha | `assets/bento.js` + Supabase | PENDING (site key empty, so it is off) |
| Rate limiting at Cloudflare | Cloudflare dashboard | IMPLEMENTED (owner-configured; expression, exclusions and how to verify are in the Rate limiting section) |
| Rotate `AUTODRAFT_TOKEN` (old value appeared in a chat) | Cloudflare + GitHub | PENDING (owner action) |
| Comment and demo rate limits | DB triggers | IMPLEMENTED, NOT VERIFIED |
| Newsletter sign-up flood guard | `ug_subscribe` | IMPLEMENTED, NOT VERIFIED |
| Account self-deletion | `ug_delete_my_account` | IMPLEMENTED, NOT VERIFIED |
| `noindex` + robots disallow for `/admin.html`, `/api/` | `admin.html`, `robots.txt` | IMPLEMENTED |

## Visitor accounts
- **Sign up:** Account page → Create account → `supabase.auth.signUp` with `display_name` metadata. With **Confirm email** on, Supabase emails a link back to the site. The profile row is created by the `ug_on_auth_user_created` trigger.
- **Sign in:** `signInWithPassword`. The account page shows two buttons first; the form slides in ("rack slide"). Phones are not auto-focused, so the keyboard opens only on tap.
- **Password reset:** `resetPasswordForEmail` → the email link opens the site in recovery mode → "Save new password".
- **Supabase settings these flows need:**
  - Site URL `https://music.mikasa.me`
  - Redirect URLs include `https://music.mikasa.me/**`
  - Email provider with sign-ups allowed and "Confirm email" on
  
  These are configured in the dashboard and **not verifiable from the repo**.
- **Account deletion:** Account page → RPC `ug_delete_my_account()`. It refuses admin accounts.
- **Newsletter unsubscribe:** every email has `/unsubscribe?t=<token>` (GET page and one-click POST) → `ug_unsubscribe`.

## Admin membership
```sql
-- in Supabase SQL Editor, after the user has signed up
insert into public.admin_users (user_id) values ('<auth user uuid>') on conflict do nothing;
```
There is no admin sign-up flow. Removing the row removes admin rights.

## Admin panel protection
`admin.html`, in order:
1. `<html class="gate">` hides the page (`visibility:hidden`) from first paint.
2. No session → `location.replace("/#/account")`.
3. Session but not in `admin_users` → redirect to `/#/account`. The member stays signed in and sees their profile.
4. Admin but `currentLevel != aal2` → the **2FA screen**:
   - **No verified TOTP factor:** unverified factors are removed, `mfa.enroll({factorType:'totp'})` runs, and a QR code plus the text secret are shown.
   - **Verified factor:** asks for the 6-digit code.
   - `mfa.challengeAndVerify` upgrades the session to `aal2`.
5. Only then does the gate lift and the panel load.

Admins open the panel from their profile ("Admin panel" button), after signing in on the normal Account page. The old admin login form still exists in the HTML but is never shown.

**Limitation:** the HTML and inline script of `admin.html` are public static files. Anyone can read the *code*, but no data or action is reachable without passing layers 2 and 3 below.

## The three enforcement layers
1. **Browser:** the gate and 2FA screen above (user experience only, not a security boundary).
2. **Pages Functions:** `/api/generate`, `/api/track-info`, `/api/music/*` (admin routes), `/api/newsletter/send`. Each one:
   - validates the token with `GET /auth/v1/user`
   - checks `admin_users`
   - checks `isAal2(request)` (JWT claim `aal`)
   
   Without `aal2` the route returns `403 {"mfa": true}`.
3. **Database (the real boundary):** RLS. See [DATABASE.md §5](DATABASE.md#5-rls-model-and-mfa).

`/api/telegram/digest` is the exception: GitHub Actions calls it with the `AUTODRAFT_TOKEN` bearer token (compared in constant time), and it uses the Supabase **secret/service key**. That key bypasses RLS, so the route only reads article text and writes its own `telegram_radar` rows; it never writes articles.

## 2FA operations
- **Requirement:** Supabase → Authentication → Multi-Factor → TOTP enabled (Supabase default). If it is off, enrolment fails and the screen says so.
- **Lost phone:** an admin without their authenticator cannot open the panel. Recovery (owner, in the Supabase dashboard): Authentication → Users → the user → remove the MFA factor. Then open `admin.html`, which shows a new QR code.
- **Adding another admin:** insert into `admin_users`. They enrol on their first visit to the panel.

## Security headers (`_headers` + `functions/_middleware.js`)
`_headers` applies to static files. Cloudflare Pages does **not** apply `_headers` to responses made by
Functions, and since the theme middleware (Tahap 3) every HTML page goes through a Function. So
`functions/api/theme/edge.js` (`SECURITY_HEADERS`) sets exactly the same headers on every HTML response,
including `admin.html` (which is never themed). **When you change a header, change it in both places**;
the edge tests compare them.

| Header | Value / meaning |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` (and CSP `frame-ancestors 'none'`) |
| `Permissions-Policy` | camera, microphone, geolocation off |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (no preload) |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Content-Security-Policy` | see the allow-list below |

**CSP allow-list:**

| Directive | Allowed |
| --- | --- |
| scripts | self, **SHA-256 hashes** for the site's own inline `<script>`s and, with `'unsafe-hashes'`, its two inline `onerror` handlers; `cdn.jsdelivr.net` (supabase-js), `static.cloudflareinsights.com` (Web Analytics), `challenges.cloudflare.com` (Turnstile). **No `'unsafe-inline'`.** Each hash is written **single-quoted** (`'sha256-…'`): an unquoted hash is dropped by the browser as an invalid source. `tests/csp.test.mjs` recomputes every hash from the files and rejects an unquoted one, so editing an inline script fails CI instead of the browser blocking it in production. |
| styles | self, `'unsafe-inline'` (needed: the theme middleware injects a per-request `<style>` and the pages use `style="…"` attributes), Google Fonts CSS |
| fonts | self, `fonts.gstatic.com` |
| images | any https, data, blob |
| media | self, https, blob (R2 via `/api/music`, Supabase Storage, Deezer previews) |
| connect | self, the Supabase project (https + wss), `cloudflareinsights.com`, Turnstile |
| frames | YouTube (nocookie and normal), Spotify, SoundCloud, Turnstile |
| other | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` |

**When you add an external service, add its host to the right directive in `_headers` and in `SECURITY_HEADERS` (`functions/api/theme/edge.js`)**, or the browser blocks it silently (look for "Content Security Policy" in the browser console).

**Changing an inline `<script>` or an `onerror=` handler:** `script-src` allows inline code only through a SHA-256 hash. After any such edit, run `node tests/csp.test.mjs`. It passes silently when every hash still matches; otherwise it prints the missing `sha256-…` value, which must be added to the `script-src` directive in **both** files above (the edge test fails if they differ). The hash is `sha256-` plus the base64 of the script text exactly as it appears between `<script>` and `</script>` (or the attribute value for a handler). Write it **single-quoted** (`script-src … 'sha256-…'`); an unquoted hash is not a valid source and the browser ignores it, so the inline script it was meant to allow is blocked. The guard test rejects an unquoted hash for exactly this reason (2026-11-23: the first hash-based header shipped unquoted; Chromium reported every hash as "invalid source" and ignored it).

Responses produced by functions (`/a/<slug>`, `/band/<slug>`, `/api/*`) may not carry these headers. **Verified in a real browser 2026-11-23** (headless Chromium against the `fix/theme-font-parity` preview): the CSP header is present on `/`, `/admin`, `/search`, a band page and an article, `supabase-js` loads, the pages render, and no CSP violation is logged.

## Turnstile captcha (PENDING)
The code is ready in `assets/bento.js`: `TURNSTILE_SITE_KEY`, `mountCaptcha()`, and `captchaToken` passed to sign-in, sign-up and reset. Turn it on **in this order**:
1. Cloudflare → Turnstile → Add widget (hostname `music.mikasa.me`, Managed).
2. Put the **site key** (public) in `TURNSTILE_SITE_KEY`, bump the `bento.js?v=` value in `index.html`, deploy.
3. Supabase → Authentication → Attack Protection → enable Captcha → provider Turnstile → paste the **secret key** (never in the repo).

If you do step 3 before step 2, every sign-in fails.

## Rate limiting (IMPLEMENTED — Cloudflare dashboard rule)
- **Database:** comments 5 per minute per member, demos 3 per day per member, newsletter sign-ups 30 per minute site-wide.
- **Edge (IMPLEMENTED):** Cloudflare → `mikasa.me` → Security → WAF → Rate limiting rules — **one** rule, set by the owner:
  - **Expression** — the public `/api/` surface, but **excluding the autopilot** (see below):
    ```
    (http.host eq "music.mikasa.me"
      and starts_with(http.request.uri.path, "/api/")
      and not http.request.uri.path in {"/api/ai-publish" "/api/news-publish"}
      and not starts_with(http.request.uri.path, "/api/telegram/"))
    ```
  - limit **100 requests per 10 s per IP**
  - action **Block** for 10 s
- **Why the exclusions matter (do not remove them):** `/api/ai-publish` is the VPS AI publisher, `/api/news-publish` is the RSS brief writer, and `/api/telegram/*` is the GitHub Actions digest plus Telegram's own webhook. Together these are the **autopilot**. They arrive in a burst when a job runs and from a single IP (the VPS or GitHub), so an IP rate limit would throttle or block them. They are already protected by a constant-time bearer-token check and their own daily caps (`AI_PUBLISH_DAILY_LIMIT`, the news `DAILY_LIMIT`), so IP rate limiting adds nothing for them and only risks breaking the autopilot.
- **Do not** enable Bot Fight Mode: it would challenge the GitHub Actions call to `/api/telegram/digest`.
- **Verification:** the rule has **not** been confirmed by an external test. A burst of 130 requests against
  `/api/music/status` on 2026-11-23 returned no 429/block (9 requests failed to connect), so its exact
  expression, threshold and path scope are unconfirmed from outside. To check by hand: send a rapid burst
  against a public endpoint such as `/api/news` and confirm it starts returning 429/blocked, then trigger
  the autopilot once (or `POST /api/news-publish` with its token) and confirm it still returns 200.

## Music files (CORS)
`/api/music/file/…` streams public R2 objects and sets `Access-Control-Allow-Origin: https://music.mikasa.me`
— a fixed origin, never the request Origin, so a foreign page can no longer read the files and a cached
response can only ever advertise that one origin. The objects are cached at the edge for a year
(`cache-control: public, max-age=31536000, immutable`), so **responses cached before 2026-11-23 still carry
the old `Access-Control-Allow-Origin: *`**. Checked live on 2026-11-23: a cache miss returns the new origin,
a cache hit still returns `*` (age ≈ 2.7 days). Purge the Cloudflare cache (Caching → Configuration →
Purge Cache) to apply it to the files already stored.

## Secrets management
- Secrets live only in **Cloudflare Pages → Settings → Variables and Secrets** (type *Secret*) and **GitHub → Settings → Secrets → Actions**. Full list: [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables).
- The Supabase **publishable** key and project URL in `bento.js` and `admin.html` are public by design.
- The Supabase **secret/service key** must never be in the repo or the browser. With new `sb_secret_…` keys, `draft-lib.js` sends it only in the `apikey` header.
- Never paste secret values into chats, issues, commits or screenshots. If one leaks, rotate it at the provider, then update Cloudflare and GitHub, then redeploy.

## Content safety
- Article Markdown and all user text are HTML-escaped before rendering (`UI.esc`, `md()` escapes first). Links in Markdown are https-only and get `rel="noopener noreferrer nofollow"`.
- YouTube embeds use `youtube-nocookie.com` with an 11-character id pattern.
- Scene Radar stores and shows only headlines, summaries of at most 45 words, and links.

## Telegram bot (editor shortcut)
- The bot lets the editor publish **without the website's 2FA**: whoever controls the editor's Telegram account can write, publish and delete **drafts**. It cannot edit, unpublish or delete published articles.
- Checks: the webhook requires Telegram's `X-Telegram-Bot-Api-Secret-Token` (SHA-256 of the bot token, so it changes when the token is revoked); only `TELEGRAM_CHAT_ID` is obeyed (sender and chat must match); callback keys are validated.
- Owner should turn on Telegram **Two-Step Verification**. To shut the bot off: revoke the token in @BotFather or delete `TELEGRAM_BOT_TOKEN`.

## Third-party script (supabase-js)
- The only third-party script with access to sessions is supabase-js from `cdn.jsdelivr.net`. It is pinned to an
  exact version and file (`@supabase/supabase-js@2.119.0/dist/umd/supabase.min.js`) with Subresource Integrity
  (`integrity="sha384-…"`, `crossorigin="anonymous"`) in `index.html` and `admin.html`. If the CDN ever served a
  different file, the browser would block it instead of running it.
- `tests/supabase-js-pin.test.mjs` (CI, every PR) downloads the file and checks the hash; the production smoke test
  checks it every 6 hours.
- To upgrade: pick a version, compute `sha384` of `dist/umd/supabase.min.js` (`openssl dgst -sha384 -binary file |
  openssl base64 -A`), change both pages together, run the tests, test login and admin on the preview.

## Theme engine
- Admin-supplied design tokens are never written into pages as typed: `assets/theme/schema.js` keeps
  only known keys, re-emits colours from parsed `#RRGGBB` numbers, accepts fonts only from an
  allow-list and clamps numbers. Tested against CSS/script injection and prototype-pollution input.
- Theme shells (`assets/themes/<id>/shell.js`) are checked by `tests/themes.test.mjs`: no network, storage,
  Supabase, `eval` or dynamic import; everything they add is marked and removed on theme change. Theme CSS is
  scoped to its own `html[data-theme]` and may not load external resources.
- Theme layouts get data only through `window.UG`: frozen copies without emails or user ids, and a
  fixed list of navigation/player actions. No Supabase client, session or admin function is exposed.
- Unknown, not-ready or failing themes fall back to `neon-bento`; the default CSS is always loaded.
- Owner decision (2026-11-18): theme preview opens in a new tab; `X-Frame-Options: DENY` and the CSP
  stay unchanged.

## Known exposure (decision needed)
The Pages output directory is the repository root, so **every file in the repo is publicly downloadable**: `README.md`, `docs/*`, `supabase/*.sql`. They contain no secrets, but they reveal the schema and architecture. The fix is to move the site into a `public/` folder and set it as the output directory. That changes deployment, so it needs the owner's approval. Tracked in [PROJECT-STATUS.md](PROJECT-STATUS.md).

## Theme system (Tahap 3)
- Visitors only read the active theme (`ug_active_theme()` returns theme, tokens and version, nothing else).
- Writing (drafts, apply, restore, reset, history) needs `ug_is_admin()` = admin row **and** `aal2`, enforced
  by RLS and inside the SECURITY DEFINER functions (`supabase/themes.sql`). `service_role` and `anon` have no
  write rights on the theme tables.
- `/api/theme/refresh` checks login, `admin_users` and `aal2` like the other admin routes; it only clears a cache.
- Tokens are validated three times: in the database (CHECK + cleaning), at the edge (`sanitizeConfig`), and in
  the browser runtime. Token CSS is written with `<` escaped, so a token cannot close the `<style>` tag.
- Preview opens in a new tab; no iframe, `X-Frame-Options: DENY` and the CSP are unchanged.

