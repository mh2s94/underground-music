# Cloudflare, deployment and automation

Audited 2026-11-17. Secret values are never written here.

## Cloudflare Pages project

| Setting | Value |
| --- | --- |
| Project | `underground-music` |
| Git repository | `mh2s94/underground-music` (GitHub) |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(empty)*: no build step |
| Build output directory | `.` (the repository root is served as-is) |
| Functions | `functions/` (Pages Functions, file-based routes) |
| Production domain | `https://music.mikasa.me` (custom domain, VERIFIED active) |
| Old domain | `https://underground-music.pages.dev`. An inline script in `index.html` and `admin.html` redirects that exact hostname to `music.mikasa.me`, keeping path, query and hash. Preview hostnames (`<branch>.underground-music.pages.dev`) are **not** redirected. |

### How deployment works
- Every push to `main` deploys production.
- Every push to another branch creates a **preview deployment** at `https://<branch>.underground-music.pages.dev`.
  - Previews may not have the production secrets (preview environment variables are separate). AI, auto-draft and similar may fail there with "Server is not configured". Use production for real work.
  - A commit message containing `[CF-Pages-Skip]` skips the Cloudflare build.
- **Merging:** the usual flow in this project is branch → pull request → squash merge → wait about 75 s.

### Checking a deployment
1. GitHub: the commit's check run named **"Cloudflare Pages"** must be `success`. CLI: `gh api repos/mh2s94/underground-music/commits/<sha>/check-runs`.
2. If it failed: Cloudflare dashboard → Workers & Pages → underground-music → Deployments → the failed one → **View details** shows the build and function bundling log. Typical causes: a syntax error in a function, an import of a missing file, or a function file exporting nothing routable that is imported incorrectly.
3. **Redeploy** without code changes: Deployments → the latest production deployment → ⋯ → **Retry deployment**. Needed after changing environment variables or bindings.
4. After a front-end change, phones may cache old assets. Bump the `?v=` query on the changed CSS or JS in `index.html`.

### Bindings

| Binding | Type | Used by | Status |
| --- | --- | --- | --- |
| `AI` | Workers AI | `generate.js`, `track-info.js` (provider `workersai`) | VERIFIED (auto-draft used `workersai`) |
| `MUSIC` | R2 bucket `underground-music` | `/api/music/*` | VERIFIED in dashboard (2026-11-17) |
| `ASSETS` | automatic | `a/[slug].js`, `band/[slug].js` (fetch `index.html`) | built in |

## Environment variables

Set in Cloudflare → Workers & Pages → underground-music → **Settings → Variables and Secrets** (Production), then redeploy. "Set?" means whether the audit could confirm it is configured. Values are never visible from the repo.

| Name | Purpose | Required | Type | Used by | Set? |
| --- | --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL | yes | plain or secret | all functions that touch the DB | yes (site works) |
| `SUPABASE_ANON_KEY` | publishable/anon key, used to verify user tokens and call RLS-protected REST | yes | secret | `generate`, `track-info`, `music`, `newsletter/send`, `a/[slug]`, `sitemap`, `unsubscribe` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` (aliases `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE`, `SERVICE_ROLE_KEY`) | secret key that bypasses RLS, used **only** by auto-draft | for auto-draft | **secret** | `auto-draft` | yes (run succeeded) |
| `AUTODRAFT_TOKEN` | shared token between GitHub Actions and `/api/auto-draft` | for auto-draft | **secret** | `auto-draft` | yes; **rotation PENDING** |
| `AUTODRAFT_COUNT` | drafts per run (1–3, default 2) | no | plain | `auto-draft` | unknown |
| `AUTODRAFT_NOTIFY` | email for the morning summary | no | plain | `auto-draft` | yes |
| `RESEND_API_KEY` | Resend API key | for newsletter | **secret** | `newsletter/send`, `auto-draft` | yes (test email sent) |
| `NEWSLETTER_FROM` | sender, e.g. `UNDERGROUND <news@mikasa.me>` (domain verified in Resend) | for newsletter | plain | `newsletter/send`, `auto-draft` | yes |
| `NEWSLETTER_REPLY_TO` | reply-to (default `hello@mikasa.me`) | no | plain | `newsletter/send` | unknown |
| `AI_PROVIDER_ORDER` | provider order (default `gemini,workersai,groq,openrouter,mistral,deepseek,openai,claude`) | no | plain | `generate`, `track-info` | unknown |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | AI provider keys; at least one provider (or the `AI` binding) is needed | at least one | **secret** | `generate`, `track-info` | unknown each |
| `CF_ACCOUNT_ID` | Cloudflare account ID for the footer "Where our readers are" box | no (box hidden without it) | plain | `readers` | PENDING (owner to add) |
| `CF_ANALYTICS_TOKEN` | Cloudflare API token, permission **Account Analytics: Read** only | no (box hidden without it) | **secret** | `readers` | PENDING (owner to add) |
| `CF_WA_HOST` | Hostname counted by `/api/readers` (default `music.mikasa.me`) | no | plain | `readers` | optional |
| `TELEGRAM_BOT_TOKEN` | Editor's Telegram bot (from @BotFather); the webhook secret is derived from it | no (bot off without it) | **secret** | `telegram/*`, `auto-draft` | PENDING (owner to add) |
| `TELEGRAM_CHAT_ID` | The only chat the bot obeys (the bot replies with it after `/start`) | no | plain | `telegram/*`, `auto-draft` | PENDING (owner to add) |
| `GEMINI_MODEL`, `WORKERSAI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `MISTRAL_MODEL`, `DEEPSEEK_MODEL`, `OPENAI_MODEL`, `CLAUDE_MODEL` | model overrides | no | plain | `generate`, `track-info` | unknown |
| `YOUTUBE_API_KEY` | YouTube Data API v3 for video lookup (else page parsing) | no | **secret** | `generate` | unknown |

**Front-end constants (in code, public by design):**

- `SUPABASE_URL`, the Supabase **publishable** key, `SUBMIT_EMAIL` and `TURNSTILE_SITE_KEY` in `assets/bento.js`
- the URL and publishable key in `admin.html`

**GitHub Actions secret:** `AUTODRAFT_TOKEN`, with the same value as in Cloudflare.

## DNS and email (zone `mikasa.me` on Cloudflare)

| Record | Purpose | Status |
| --- | --- | --- |
| `music` → Pages custom domain (added by Pages) | the site | VERIFIED |
| Google Search Console TXT on the root (Domain property `mikasa.me`) | ownership; **keep it** | VERIFIED |
| Resend records on the `send.` subdomain | newsletter sending | VERIFIED (test email) |
| Cloudflare Email Routing for `hello@mikasa.me` | contact address | VERIFIED (owner created it) |
| `_dmarc` TXT `v=DMARC1; p=quarantine; adkim=r; aspf=r` | email reputation | recommended; PENDING confirmation |

Cloudflare Web Analytics is enabled by the owner (automatic beacon). The CSP allows `static.cloudflareinsights.com`.

## GitHub Actions

| Workflow | File | Trigger | Needs |
| --- | --- | --- | --- |
| Daily AI drafts | `.github/workflows/auto-draft.yml` | cron `43 21 * * *` (21:43 UTC = 06:43 WIT) + manual **Run workflow** | secret `AUTODRAFT_TOKEN` |

- **Debugging:** Actions → Daily AI drafts → the run → step "Ask the site to write today's drafts". The log prints the JSON answer and the HTTP code:
  - `401`: token mismatch between GitHub and Cloudflare
  - `503` with `variables_seen`: the service key name is missing in Cloudflare
  - `502`: no headlines, or every AI provider failed (see `failed`)
  - `200` with `note`: every recent headline was already written
- GitHub may delay scheduled runs by several minutes.
- A branch `radar-audit` (a one-off read-only archive audit, not merged) may still exist on GitHub. It can be deleted. Its workflow only ran on pushes to that branch.

## Static SEO files
- `robots.txt`: allow all, disallow `/admin.html` and `/api/`, sitemap link.
- `functions/sitemap.xml.js`: home, privacy, terms, published articles, band pages.
- `manifest.webmanifest` plus the icons and `assets/og.png` share image.
- Google Search Console: Domain property `mikasa.me` verified. Indexing of the site is not yet confirmed (PENDING).


**Dashboard check 2026-11-17 (owner screenshot):** variables present: `ANTHROPIC_API_KEY`, `AUTODRAFT_NOTIFY`, `AUTODRAFT_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `NEWSLETTER_FROM`, `RESEND_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_R…` (service key), `SUPABASE_URL`. Bindings: R2 `MUSIC` → `underground-music`, Workers AI `AI`. Build output directory `.`, root directory empty.

## Theme middleware (Tahap 3)
- `_routes.json` must sit in the **build output directory**. This project has no build step and its output
  directory is the repository root (`.`), so the file is `/_routes.json` next to `index.html` and `_headers`.
  If the output directory is ever changed (for example to `public`), `_headers`, `_routes.json`, `index.html`
  and `assets/` must all move there together, while `functions/` stays at the root.
- `_routes.json` tells Pages which URLs run Functions: everything except `/assets/*`,
  `robots.txt`, `manifest.webmanifest`, `favicon.ico`. No dashboard setting is needed.
- `functions/_middleware.js` uses `SUPABASE_URL` / `SUPABASE_ANON_KEY` when set and otherwise the public
  project URL and publishable key built into `functions/api/theme/edge.js`, so preview deployments work
  without secrets. It never uses the service-role key.
- Every pull request runs **Preview check** (`.github/workflows/preview-check.yml` →
  `.github/scripts/verify-preview.sh`): waits for the Cloudflare preview of the commit and checks that static
  files are byte-identical to the repo (so the output directory is the root), are not themed, HTML pages carry
  the theme and the same security headers as `_headers`, and API endpoints answer exactly like production.
- Check after a deploy: `curl -s -D - -o /dev/null https://music.mikasa.me/ | grep -i "x-ug-theme\|x-frame-options\|content-security"`.
