# Theme Engine — Monochrome Modular Only

Status: single-theme architecture is the target state of this change. Production cleanup is a separate, owner-run SQL step.

## Theme policy

`monochrome-modular` is the only supported theme and the permanent default. Theme selection is not exposed in Admin Settings. The Theme Manager remains available for editing design tokens (colours, typography, radius and scanlines), saving drafts, previewing, applying, restoring and resetting those tokens.

Legacy theme identifiers are rejected by the browser schema, edge middleware and database allow-list. Invalid or missing configuration resolves to `monochrome-modular`.

## Active implementation

| Layer | Files |
| --- | --- |
| Theme schema and token baseline | `assets/theme/schema.js` |
| Browser runtime | `assets/theme/runtime.js` |
| Edge validation and HTML injection | `functions/api/theme/edge.js` |
| Theme layout and shell | `assets/themes/monochrome-modular/theme.css`, `shell.js` |
| Admin token editor | `admin.html`, `assets/theme/manager.js` |
| Database functions and constraints | `supabase/themes.sql` |
| Production data cleanup | `supabase/theme-singleton-cleanup.sql` |

## Token and runtime behavior

The theme schema is the single source of truth. `DEFAULT_THEME` is `monochrome-modular`; `THEMES` and `READY` contain exactly that one identifier. `DEFAULTS` and the theme catalogue entry use the Monochrome Modular black, white and grayscale palette.

The edge reads `ug_active_theme()`, validates the response and injects the theme stylesheet, shell and sanitized tokens. A legacy or unknown theme id is rejected and falls back to the sole supported theme. Last-good caching remains enabled, but only valid Monochrome Modular configurations may enter it.

The browser runtime accepts shell registration and loading only for `monochrome-modular`. The shell uses `window.UG` and `ug:*` events; it does not access Supabase or perform network requests.

## Admin workflow

- The Settings panel identifies Monochrome Modular as the locked, permanent theme.
- Admins can edit the supported design tokens and review WCAG contrast.
- Drafts and history are filtered to the only supported theme.
- Apply, Restore and Reset continue to use the existing admin-only RPC functions.
- Reset restores the Monochrome Modular token baseline; it does not switch themes.

## Database rollout

Deploy the application code first, then run `supabase/theme-singleton-cleanup.sql` in Supabase SQL Editor. The script:
1. Sets the singleton active row to Monochrome Modular and increments its version.
2. Deletes saved configs for legacy themes.
3. Deletes history entries for legacy themes that can no longer be restored.
4. Writes a cleanup/reset history entry and reloads the PostgREST schema.

`supabase/themes.sql` now allows only `monochrome-modular` through `ug_theme_id_ok()`. Re-run that schema file only if the database function needs to be updated; the one-time cleanup is in the separate SQL file.

## Automated checks

Run:

- `node tests/themes.test.mjs`
- `node tests/theme-edge.test.mjs`
- `node .github/scripts/themes-check.mjs <preview-url>` (Playwright desktop/phone smoke check)

The tests verify the single-item catalogue, rejection of legacy identifiers, CSS scoping, shell registration, edge injection and branding asset references.