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
| Security headers incl. CSP + HSTS | `_headers` (static) + `functions/api/theme/edge.js` (HTML pages) | IMPLEMENTED, NOT VERIFIED live (CSP mock-tested locally, no violations) |
| Cloudflare Turnstile captcha | `assets/bento.js` + Supabase | PENDING (site key empty, so it is off) |
| Rate limiting at Cloudflare | Cloudflare dashboard | PENDING (owner action) |
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

`/api/auto-draft` is the exception: GitHub Actions calls it with the `AUTODRAFT_TOKEN` bearer token (compared in constant time), and it writes with the Supabase **secret/service key**. That key bypasses RLS, so the route only inserts drafts.

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
| scripts | self, `'unsafe-inline'` (needed: inline admin script and `onerror` attributes), `cdn.jsdelivr.net` (supabase-js), `static.cloudflareinsights.com` (Web Analytics), `challenges.cloudflare.com` (Turnstile) |
| styles | self, inline, Google Fonts CSS |
| fonts | self, `fonts.gstatic.com` |
| images | any https, data, blob |
| media | self, https, blob (R2 via `/api/music`, Supabase Storage, Deezer previews) |
| connect | self, the Supabase project (https + wss), `cloudflareinsights.com`, Turnstile |
| frames | YouTube (nocookie and normal), Spotify, SoundCloud, Turnstile |
| other | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` |

**When you add an external service, add its host to the right directive in `_headers` and in `SECURITY_HEADERS` (`functions/api/theme/edge.js`)**, or the browser blocks it silently (look for "Content Security Policy" in the browser console).

Responses produced by functions (`/a/<slug>`, `/band/<slug>`, `/api/*`) may not carry these headers. This is IMPLEMENTED, NOT VERIFIED: check with the browser's network tab.

## Turnstile captcha (PENDING)
The code is ready in `assets/bento.js`: `TURNSTILE_SITE_KEY`, `mountCaptcha()`, and `captchaToken` passed to sign-in, sign-up and reset. Turn it on **in this order**:
1. Cloudflare → Turnstile → Add widget (hostname `music.mikasa.me`, Managed).
2. Put the **site key** (public) in `TURNSTILE_SITE_KEY`, bump the `bento.js?v=` value in `index.html`, deploy.
3. Supabase → Authentication → Attack Protection → enable Captcha → provider Turnstile → paste the **secret key** (never in the repo).

If you do step 3 before step 2, every sign-in fails.

## Rate limiting (PENDING)
- **Database:** comments 5 per minute per member, demos 3 per day per member, newsletter sign-ups 30 per minute site-wide.
- **Edge (recommended):** Cloudflare → `mikasa.me` → Security → WAF → Rate limiting rules:
  - match Hostname `music.mikasa.me` AND URI path starts with `/api/`
  - limit 100 requests per 10 s per IP
  - action Block for 10 s
- **Do not** enable Bot Fight Mode: it would challenge the GitHub Actions call to `/api/auto-draft`.

## Secrets management
- Secrets live only in **Cloudflare Pages → Settings → Variables and Secrets** (type *Secret*) and **GitHub → Settings → Secrets → Actions**. Full list: [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables).
- The Supabase **publishable** key and project URL in `bento.js` and `admin.html` are public by design.
- The Supabase **secret/service key** must never be in the repo or the browser. With new `sb_secret_…` keys, `auto-draft.js` sends it only in the `apikey` header.
- Never paste secret values into chats, issues, commits or screenshots. If one leaks, rotate it at the provider, then update Cloudflare and GitHub, then redeploy.

## Content safety
- Article Markdown and all user text are HTML-escaped before rendering (`UI.esc`, `md()` escapes first). Links in Markdown are https-only and get `rel="noopener noreferrer nofollow"`.
- YouTube embeds use `youtube-nocookie.com` with an 11-character id pattern.
- Scene Radar stores and shows only headlines, summaries of at most 45 words, and links.

## Telegram bot (editor shortcut)
- The bot lets the editor publish **without the website's 2FA**: whoever controls the editor's Telegram account can write, publish and delete **drafts**. It cannot edit, unpublish or delete published articles.
- Checks: the webhook requires Telegram's `X-Telegram-Bot-Api-Secret-Token` (SHA-256 of the bot token, so it changes when the token is revoked); only `TELEGRAM_CHAT_ID` is obeyed (sender and chat must match); callback keys are validated.
- Owner should turn on Telegram **Two-Step Verification**. To shut the bot off: revoke the token in @BotFather or delete `TELEGRAM_BOT_TOKEN`.

## Theme engine
- Admin-supplied design tokens are never written into pages as typed: `assets/theme/schema.js` keeps
  only known keys, re-emits colours from parsed `#RRGGBB` numbers, accepts fonts only from an
  allow-list and clamps numbers. Tested against CSS/script injection and prototype-pollution input.
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

