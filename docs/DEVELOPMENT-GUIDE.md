# Development guide (read this before changing anything)

These rules are permanent. They apply to every AI assistant and developer who works on UNDERGROUND.

## Rules
1. **Read `README.md` and the relevant file in `docs/` first.** Then read the actual code you will touch. Do not rely on names alone.
2. **Audit before changing.** Find every place a feature is used (`grep` the function, table, CSS class, route) before editing it.
3. **Do not delete existing features to fix a new one.** If two features conflict, stop and ask the owner.
4. **Never disable RLS, MFA/2FA (`aal2` checks) or security headers (`public/_headers`, CSP)** as a workaround without the owner's explicit approval. Diagnose instead (admin → Settings → Security check).
5. **Never show, log, commit or paste secrets:**
   - API keys
   - the Supabase secret or service key
   - `AUTODRAFT_TOKEN`
   - Resend keys
   - Turnstile secret keys
   
   Ask the owner to set them in Cloudflare or GitHub themselves.
6. **No destructive SQL** (drop, delete, truncate, disabling RLS, changing `ug_is_admin()` back) without explicit approval.
7. **A deployment is not done until it is checked:**
   - the GitHub check run "Cloudflare Pages" is `success`
   - the feature works on `https://music.mikasa.me` (not on a preview URL)
8. **Every database change is a documented SQL file** in `supabase/`:
   - idempotent
   - with a header comment saying what it does and what it must run after
   - [DATABASE.md](DATABASE.md) updated
9. **Every new feature is tested and documented.** Test at a phone width (about 412 px) and at desktop width. Note in [PROJECT-STATUS.md](PROJECT-STATUS.md) whether it was verified live or only locally.
10. **Update the docs in the same change** whenever architecture, database, configuration, features or workflows change.
11. **Record incidents:** symptom, cause, fix, in [TROUBLESHOOTING.md](TROUBLESHOOTING.md) (and DATABASE.md for RLS).
12. **Separate facts from guesses:** use the labels VERIFIED, IMPLEMENTED, NOT VERIFIED, PENDING. Never claim something works because the code exists.

## Owner preferences (from the project history)
- The owner writes in **Indonesian**. Answer in Indonesian, in plain language. The owner is not a programmer: give click-by-click dashboard steps.
- Before changing the look of something, the owner usually wants **options to compare first**. Show 5–10 concepts, or a live preview on a branch preview URL, then implement the chosen one.
- Ask before big or costly work. Nothing is published automatically. AI output is always a draft that a human publishes.
- The owner granted push permission for this repository. Production changes still go through the normal branch → PR → squash merge → check flow.

## Workflow
1. `git checkout main && git pull`, then create a branch with a descriptive name.
2. Make the change.
3. If you changed CSS or JS, **bump the `?v=` query** of that file in `public/index.html` (or `public/admin.html`). Without it, phones keep the old file.
4. Test locally:
   - Serve the website folder: `python3 -m http.server -d public` (functions do not run this way; stub `/api/*` in tests).
   - Supabase and the APIs can be stubbed in Playwright. Previous sessions stubbed `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` with a fake `window.supabase` and stubbed `/api/news`.
   - Check the console for errors and CSP violations at 412 px and 1280 px.
   - Functions: `node --input-type=module -e "import('file://…/functions/api/x.js')"` catches syntax and import errors.
5. Commit with a clear message, open a PR, squash-merge, and wait about 75 s. Check:
   ```bash
   gh api repos/mh2s94/underground-music/commits/<sha>/check-runs --jq '.check_runs[]|[.name,.status,.conclusion]'
   ```
6. Verify on production. Tell the owner what to check if you cannot reach the site yourself.
7. Update the docs.

## Where things go

| Change | Files |
| --- | --- |
| Public UI or behaviour | `public/assets/bento.js`, `public/assets/bento.css` (+ `account.css`, `launch.css`), `public/index.html` |
| Admin UI | `public/admin.html` (inline script) |
| Server logic, secrets, external APIs | `functions/api/*.js` |
| SEO HTML for a path | `functions/<path>/[param].js` with HTMLRewriter over `env.ASSETS` |
| Database | new or updated `supabase/*.sql` + DATABASE.md |
| New external host (script, iframe, font, API from the browser) | `public/_headers` CSP |
| Genres | **both** `public/assets/genres.js` and `functions/api/genres-data.js` |
| Scheduled job | `.github/workflows/*.yml` + secrets documented in DEPLOYMENT.md |

## Conventions and gotchas
- **Admin API routes** verify the session with `/auth/v1/user`, check `admin_users`, then `isAal2(request)` from `functions/api/aal.js`. Copy that pattern for any new admin route.
- **Admin-only RLS** uses `public.ug_is_admin()`, which already requires `aal2`. If the admin reads a row back after writing (`.select()` / RETURNING), a **SELECT** policy must cover it. See the 2026-11-17 incident in DATABASE.md.
- **Workers free-plan limits:** 50 subrequests per invocation, about 100 s response time. Long jobs must be split into steps (see `charts.js`, which uses about 42 subrequests).
- **Supabase secret keys `sb_secret_…`** go only in the `apikey` header (not as Bearer).
- **Deezer preview URLs expire:** never store them. Use `/api/preview?id=`.
- **Scene Radar** must keep using only headlines, summaries of at most 45 words, and links (copyright).
- **Visitors never see `public/admin.html`.** Keep the `html.gate` pattern and the redirects.
- **Only `public/` is served.** Website files go in `public/`. Docs, SQL, scripts and function sources stay outside it. `_headers` must stay in `public/`, or every security header disappears silently. Still never commit secrets: the GitHub repo itself may be visible to others.

## Testing checklist for releases
- Home, Articles, an article page `/a/<slug>`, Music (play, seek), Charts (community and global, preview plays), Band page, Search, Account (sign up, sign in, reset), newsletter sign-up, at 412 px and desktop.
- Admin: 2FA screen → panel, Generate, Save draft, Publish, Scene Radar batch, Music upload, Settings → Security check (lines 4 and 5 ok).
- Browser console: no errors, no CSP violations.
