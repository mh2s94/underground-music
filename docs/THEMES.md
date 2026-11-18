# Themes (Theme Engine)

Status (2026-11-19, production `main`):
- **Tahap 1, fondasi:** VERIFIED, merged (PR #48).
- **Tahap 2, `supabase/themes.sql`:** VERIFIED. Applied to production by the owner on 2026-11-18 and verified
  (owner test: drafts saved in Supabase, Security Check passed). Do not re-run without a technical reason.
- **Tahap 3, edge middleware + Theme Manager:** VERIFIED, merged (PR #49, 2026-11-18). Owner tested on production:
  catalogue, preview, save draft, Apply, Restore, Reset.
- **Edge resilience:** VERIFIED, merged (PR #50, 2026-11-18): 2 s RPC timeout, last valid theme on failure.
  Production read `neon-bento@5;rpc` / `;cache` from Indonesia, Dallas (DFW) and Stockholm (ARN).
- **Active theme on production:** `neon-bento`, version 5 (Neon Bento is the only ready theme).
- Themes 01–10 stay "Tahap berikutnya": they cannot be previewed as a final theme or applied (owner decision
  2026-11-18). They are follow-up work, not part of the finished project. Rencana lengkap:
"UNDERGROUND · Rancangan Theme Manager" (dokumen yang disetujui owner pada 2026-11-18).

## Goal
The admin can switch the whole look and layout of music.mikasa.me from the admin panel, for every
visitor, without a code change or redeploy. Themes change **structure and style only**. Data,
accounts, comments, saves, the player, charts, the newsletter, the admin panel, the API and RLS are
the same in every theme.

## Layers

| Layer | Files | Status |
| --- | --- | --- |
| Design tokens | top of `assets/bento.css` | IMPLEMENTED |
| Theme schema (single source of truth) | `assets/theme/schema.js` | IMPLEMENTED |
| Browser runtime | `assets/theme/runtime.js` (`window.UGTheme`) | IMPLEMENTED |
| Data/action contract | `window.UG` + `ug:*` events in `assets/bento.js` | IMPLEMENTED |
| Layout regions | `data-ug-region` attributes in `index.html` | IMPLEMENTED |
| Database tables + RPCs | `supabase/themes.sql` | VERIFIED (applied 2026-11-18) |
| Edge loader + last valid theme | `functions/_middleware.js`, `functions/api/theme/edge.js`, `_routes.json` | VERIFIED (PR #49, #50) |
| Cache refresh after Apply | `functions/api/theme/refresh.js` (`POST /api/theme/refresh`) | VERIFIED (PR #49) |
| Admin preview in a new tab | `assets/theme/preview.js` (loaded by the runtime for `?ug-preview=<id>`) | VERIFIED (owner test) |
| Theme Manager | `admin.html` → Settings → Tema situs (`assets/theme/manager.js`, `manager.css`) | VERIFIED (owner test: Apply, Restore, Reset) |
| Theme layouts | `assets/themes/<id>/theme.css`, `shell.js` | PENDING (Tahap 4+) |

## 1. Design tokens (top of `assets/bento.css`)
Every visual value a theme or the admin may change is a `--ug-*` custom property on `:root`.

- Colours come in pairs: the hex value and an `r g b` triplet for translucent use, for example
  `--ug-accent: #FF2E63; --ug-accent-rgb: 255 46 99;` used as `rgb(var(--ug-accent-rgb) / .4)`.
- `bento.css` keeps its short aliases (`--neon`, `--bg`, `--card`, `--display`…) but they are now
  defined from the tokens, so all component CSS follows the tokens.
- All former hard-coded neon/UV/status `rgba(…)` values and the pale tints (`#FFE3EC`, `#E4DCFF`,
  `#D6D0EC`) in `bento.css`, `account.css` and `launch.css` now read tokens.
- The tokens sit at the top of `bento.css` on purpose: a separate file could fail to load on its own
  and leave the site without colours (found in testing, 2026-11-18). Every page that loads
  `bento.css` (`index.html`, `privacy.html`, `terms.html`, `/unsubscribe`) therefore has them.

| Token | Default (Neon Bento) | Used for |
| --- | --- | --- |
| `--ug-void`, `--ug-bg`, `--ug-shell` | `#050409`, `#07060B`, `#0A0912` | page backgrounds |
| `--ug-surface`, `-2`, `-3` | `#0E0C16`, `#15121F`, `#1B1729` | cards, panels |
| `--ug-line`, `--ug-line-2` | `#221C36`, `#2E2648` | borders |
| `--ug-ink`, `--ug-ink-soft`, `--ug-muted`, `--ug-faint` | `#F2EEFF`, `#D6D0EC`, `#A9A3C2`, `#7D769E` | text |
| `--ug-accent`, `-hi`, `-tint`, `--ug-on-accent` | `#FF2E63`, `#FF5C86`, `#FFE3EC`, `#07060B` | primary colour ("neon") |
| `--ug-accent-2`, `-hi`, `-tint` | `#7B5CFF`, `#A48FFF`, `#E4DCFF` | secondary colour ("UV") |
| `--ug-ok`, `--ug-warn` | `#3DF5A7`, `#FFC23D` | status |
| `--ug-font-display`, `-body`, `-mono` | Bebas Neue, Inter, Space Mono | typography |
| `--ug-radius`, `--ug-radius-pill` | `16px`, `999px` | shape |
| `--ug-ease-out` | `cubic-bezier(.16,1,.3,1)` | motion |
| `--ug-scanlines` | `1` | VHS scanline overlay (0 hides it) |

## 2. Schema (`assets/theme/schema.js`)
Pure functions, no DOM, exposed as `globalThis.UGThemeSchema` (frozen). Loaded by the browser now and
imported by the edge middleware in Tahap 2, so browser, edge and database accept the same things.

- `THEMES`: the catalogue of 11 themes (`neon-bento` + the ten concepts). `status: "ready"` themes
  may be applied; `"planned"` themes are listed but never loaded. Today only `neon-bento` is ready.
- `TOKENS`: the token keys the admin may set (`accent`, `accent2`, `bg`, `surface`, `ink`,
  `fontDisplay`, `radius`, `scanlines`, …), each with its type and CSS variable.
- `FONTS`: the font allow-list (key → font stack + Google Fonts family).
- `sanitizeTokens(obj)` → `{ tokens, css, rejected }`. Unknown keys are dropped. Colours must be a
  string `#RRGGBB` exactly (no trimming) and are re-emitted upper-case; fonts must be allow-list keys;
  numbers must be a JSON number or numeric string with at most 6 integer digits and 2 decimals, and
  are clamped, never rounded. The same rules are in `supabase/themes.sql` (`ug_clean_theme_tokens`);
  a parity test runs both on 273 inputs. Change both together.
  Values are never copied as written, which is what makes admin tokens safe to inject.
- `sanitizeConfig({ theme, tokens })`: a malformed id or a theme that is not ready becomes `neon-bento`.
- `cssText(css)`: a `:root{…}` block from sanitized custom properties (only `--ug-*` names).
- `fontHref(tokens)`: Google Fonts URL for non-default fonts, or `""`.
- `contrast(a, b)`: WCAG contrast ratio, for warnings in the Theme Manager.

## 3. Runtime (`assets/theme/runtime.js`, `window.UGTheme`)
Loaded in `<head>` after `schema.js` and before the stylesheets.

- Reads `<html data-theme>`. Missing → `neon-bento`. Unknown or not ready → fallback to `neon-bento`.
- `UGTheme.load(id, { version, tokens })`: removes the previous theme, applies tokens, loads
  `/assets/themes/<id>/theme.css?v=<version>` and `shell.js?v=<version>`. Any load error, or more
  than 5 s, → `fallback()`.
- `UGTheme.fallback(reason)`: removes theme files and tokens, sets `data-theme="neon-bento"` and
  `data-theme-fallback="<reason>"`, fires `ug:theme-fallback`. The default CSS is always loaded, so
  the site never goes blank.
- An `error` listener catches failures of theme files injected into the HTML (marked
  `data-ug-theme-asset`) and falls back.
- `UGTheme.setTokens(obj)` / `clearTokens()`: apply validated tokens on `<html>` (preview).
- `UGTheme.current()`, `version()`, `lastFallback()`, `themes()`.

## 3a. Edge loader (`functions/_middleware.js`)
Runs on every page request (not on `/assets/*`, see `_routes.json`).

1. Asks Supabase `POST /rest/v1/rpc/ug_active_theme` with the public key (never the service-role key).
   Timeout **2000 ms** (edge locations far from Singapore, for example in the US, need 0.3–0.9 s).
   The answer is checked strictly (`validConfig`): a known theme id, a non-negative integer `version`,
   and tokens of which the sanitizer rejects none. Anything else counts as a failed read. A known theme
   that is not ready yet is shown as `neon-bento`.
2. Caches the answer in the Cloudflare cache (`caches.default`, key `/__ug/theme-active`) for **30 s**
   (failures 15 s). Every visitor sees a new theme within ≤ 60 s, and right away in the data centre
   that served the admin (see `/api/theme/refresh`).
3. Writes into the HTML: `<html data-theme="<id>" data-theme-version="<v>">`, a
   `<style id="ug-theme-tokens">` with the tokens, the Google Fonts link (`#ug-theme-fonts`) when a
   font token is set, and the theme's own CSS/JS files once a theme has them.
4. Response headers: the full security header set from `_headers` (Pages does not apply `_headers`
   to Functions responses, so the middleware sets the same values; a test keeps them identical),
   `cache-control: public, max-age=0, must-revalidate`, and `x-ug-theme: <id>@<version>;<source>`
   (`source` = `rpc`, `cache`, `stale`, `cache-stale`, `fallback`, `cache-fallback`).
5. **Last good theme.** Every valid answer is also kept as "last good": in memory and in the edge cache
   (`/__ug/theme-last-good`, 7 days, per host). It is validated again whenever it is read back.
   On any error, timeout, bad JSON or invalid data the middleware serves the last good theme
   (`source` `stale` / `cache-stale`). Only when no valid theme was ever read at that location does it
   serve `neon-bento` with no tokens (`fallback` / `cache-fallback`). Invalid data is never served and
   never becomes last good. A failed read is remembered for 15 s, then the database is asked again.
   The page is never blocked: the original HTML is returned.
6. Subrequests per page (Cache API calls count like `fetch()`): cache hit 1; cache miss 3–4
   (1 cache read, 1 RPC, 1–2 cache writes); failure 3–4. Free plan limit: 50 per request.
7. Not themed (headers only): `admin.html`, HEAD requests, redirects, server errors. 404 pages are themed.

If the RPC cannot be read (Supabase down, wrong `SUPABASE_URL`), pages show the last valid theme, or Neon Bento
when that location never read one. Preview deployments read the same production database (public key only).

### `POST /api/theme/refresh`
Admin + 2FA (`aal2`) only (401 without login, 403 for a member or an admin without 2FA). Clears the
cached theme in the current Cloudflare data centre and reads it again. The Theme Manager calls it
after Apply, Restore and Reset. Other data centres update within 30 s.

## 3b. Theme Manager (admin → Settings → "Tema situs")
- Shows the active theme, version and time; the 11 themes as cards (only ready themes can be chosen;
  the others say "Tahap berikutnya").
- Editor: accent, accent 2, background, surface, text, muted text, display font, body font, radius,
  scanlines, plus a WCAG contrast check and a live sample. Only values that differ from the defaults are
  saved.
- **Simpan draft** → `site_theme_configs` (RLS: admin + 2FA).
- **Preview desktop / Preview HP** → opens `/?ug-preview=<config id>` in a **new tab** (HP: a 390×844
  window). `assets/theme/preview.js` shows the draft only when the session is an admin with 2FA (own
  `admin_users` row readable); for anyone else the link shows the normal public theme. No iframe,
  `X-Frame-Options: DENY` and the CSP are unchanged. A banner says the draft is not applied yet;
  "Keluar preview" returns to the public theme.
- **Terapkan** (confirm dialog) → `ug_apply_theme`, then `/api/theme/refresh`.
- **Riwayat** → **Pulihkan** calls `ug_restore_theme(history id)`; **Reset ke default** calls
  `ug_reset_theme` (Neon Bento, no tokens). Every action is a new version and a history row.
- If the SQL has not been run yet, the panel shows a setup notice and stays read-only; the public site
  keeps Neon Bento.

## 4. Theme contract (`window.UG`, `assets/bento.js`)
The only way a theme layout reads data or triggers actions. Everything is a frozen copy: a theme can
show and arrange content but cannot change data or reach Supabase, sessions or admin functions.

| Member | Contents |
| --- | --- |
| `UG.contract` | `1` (bump when the contract changes incompatibly) |
| `UG.view` | current view name (`home`, `articles`, `music`, `charts`, `about`, `account`, `band`) |
| `UG.articles` | published articles: `id, slug, key, title, excerpt, genre, kind, score, band, album, cover, publishedAt, url, bandUrl` |
| `UG.tracks` | published tracks: `id, title, artist, genre, album, cover, durationSec` |
| `UG.user` | `{ signedIn, name }` (no email, no id) |
| `UG.player` | `{ track, playing }` |
| `UG.helpers` | `timeAgo, readTime, fmtDate, esc` |
| `UG.actions` | `go(path)`, `openArticle(key)`, `playTrack(id)`, `togglePlay()`, `next()`, `prev()`, `openSearch()`, `closeSearch()` |

Events on `document`: `ug:data` (`{type:"articles"|"tracks", count}`), `ug:view` (`{view}`),
`ug:user` (`{signedIn}`), `ug:player` (`{trackId, playing}`), `ug:ready`, `ug:theme`,
`ug:theme-fallback`.

## 5. Layout regions (`index.html`)
`data-ug-region` marks the parts a theme may move or restyle: `nav` (sidebar / tab bar), `main`
(scrolling content, contains the views and the footer), `footer`, `player`, `search`, `reader`.
Views keep `data-view="<name>"`. A theme must keep every region usable: it may move, restyle or
re-arrange them, never remove one.

## 6. Making a new theme (from Tahap 4)
1. Add `assets/themes/<id>/theme.css` with every rule scoped under `html[data-theme="<id>"]`, plus
   token overrides in `html[data-theme="<id>"] { --ug-…: …; }`.
2. Optional `assets/themes/<id>/shell.js`: re-arranges regions and renders theme-only components
   using `window.UG` and `ug:*` events only. No network calls, no Supabase, no `innerHTML` with
   unescaped data (use `UG.helpers.esc`).
3. Set the theme to `status: "ready"` in `assets/theme/schema.js` only after it passes the release
   checklist on desktop (1280 px) and phone (390 px) for every view, plus the fallback tests.
4. Preview and owner ACC before merge (owner rule).

## 7. Rules
- Never hard-code a colour, font or radius in component CSS: use a token or an alias.
- Never weaken CSP, X-Frame-Options (stays `DENY`), HSTS, RLS or MFA for a theme feature. Preview
  opens in a new tab, never an iframe (owner decision 2026-11-18).
- The default theme `neon-bento` is the permanent fallback and must always work with no theme files.
- Bump `?v=` on `bento.css` and `assets/theme/*` links when changing them (`index.html`, legal pages, unsubscribe).
