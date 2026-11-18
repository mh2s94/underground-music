// Theme engine at the edge (Tahap 3). Shared by functions/_middleware.js and /api/theme/refresh.
// No request handler here, so this file is not a public endpoint.
//
// What it does for every public HTML page:
//   1. Reads the active theme through the public RPC ug_active_theme() (supabase/themes.sql),
//      cached at the edge for CACHE_TTL seconds, with a hard timeout.
//   2. Validates it with the same schema the browser and the database use (assets/theme/schema.js).
//   3. Writes data-theme / data-theme-version on <html>, a <style> block with the validated tokens,
//      the Google Fonts link for non-default fonts, and the theme's own files when it has any.
//   4. Sets the security headers explicitly: Cloudflare does not apply _headers to responses that
//      go through Pages Functions, so without this every page would lose CSP, HSTS, X-Frame-Options.
// Any failure (database down, migration not applied, timeout, bad data) means: neon-bento, page intact.

import "../../../assets/theme/schema.js";

const S = globalThis.UGThemeSchema;

// Public values (the same ones the browser uses in admin.html). Environment variables win when set.
const PUBLIC_SUPABASE_URL = "https://lhhmzfwjznlwkentbakv.supabase.co";
const PUBLIC_SUPABASE_KEY = "sb_publishable_MQDqmSmPb3qiSODbBOSKmA_U7aBEFtN";

export const CACHE_TTL = 30;          // seconds a good answer is reused at one edge location
export const CACHE_TTL_FAIL = 15;     // seconds a failed read is remembered (avoid hammering the DB)
export const RPC_TIMEOUT_MS = 800;
export const DEFAULT = Object.freeze({ theme: S.DEFAULT_THEME, tokens: {}, css: {}, version: "0", source: "default" });

// Must stay identical to the "/*" block in _headers (a test compares them).
export const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://lhhmzfwjznlwkentbakv.supabase.co wss://lhhmzfwjznlwkentbakv.supabase.co https://cloudflareinsights.com https://challenges.cloudflare.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://open.spotify.com https://w.soundcloud.com https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
});

export function applySecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return headers;
}

export function supabaseConfig(env) {
  const url = (env && env.SUPABASE_URL) || PUBLIC_SUPABASE_URL;
  const key = (env && env.SUPABASE_ANON_KEY) || PUBLIC_SUPABASE_KEY;
  return { url: String(url).replace(/\/+$/, ""), key: String(key) };
}

// The cache entry lives per host (production and previews never share it) under a path that no
// real page uses.
export function cacheKey(requestUrl) {
  return new Request(new URL("/__ug/theme-active", requestUrl).toString(), { method: "GET" });
}

function cacheStore() {
  try { return typeof caches !== "undefined" && caches.default ? caches.default : null; } catch { return null; }
}

// Turn whatever the RPC returned into a safe configuration. Only "ready" themes survive.
export function normalise(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT, source: "invalid" };
  const cfg = S.sanitizeConfig({ theme: raw.theme, tokens: raw.tokens });
  const v = Number(raw.version);
  const version = Number.isSafeInteger(v) && v >= 0 ? String(v) : "0";
  return { theme: cfg.theme, tokens: cfg.tokens, css: cfg.css, version, source: "rpc" };
}

// Read the active theme: edge cache first, then the RPC. Never throws.
export async function readActiveTheme(env, requestUrl, { waitUntil, bypassCache = false, fetchImpl } = {}) {
  const store = cacheStore();
  const key = cacheKey(requestUrl);
  if (store && !bypassCache) {
    try {
      const hit = await store.match(key);
      if (hit) {
        const data = await hit.json();
        return { ...normalise(data.value), source: data.ok ? "cache" : "cache-fallback" };
      }
    } catch { /* fall through to the RPC */ }
  }

  const { url, key: apikey } = supabaseConfig(env);
  const doFetch = fetchImpl || fetch;
  let value = null, ok = false;
  try {
    const headers = { apikey, "content-type": "application/json", accept: "application/json" };
    if (!apikey.startsWith("sb_")) headers.Authorization = "Bearer " + apikey; // legacy anon JWT
    const res = await doFetch(url + "/rest/v1/rpc/ug_active_theme", {
      method: "POST", headers, body: "{}", signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length < 20000) { value = JSON.parse(text); ok = !!value && typeof value === "object"; }
    }
  } catch { ok = false; }

  const result = ok ? normalise(value) : { ...DEFAULT, source: "fallback" };
  if (store) {
    const body = JSON.stringify({ ok, value: ok ? { theme: result.theme, tokens: result.tokens, version: Number(result.version) } : null });
    const put = store.put(key, new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=" + (ok ? CACHE_TTL : CACHE_TTL_FAIL) }
    })).catch(() => {});
    if (waitUntil) waitUntil(put); else await put;
  }
  return result;
}

export async function purgeActiveTheme(requestUrl) {
  const store = cacheStore();
  if (!store) return false;
  try { return await store.delete(cacheKey(requestUrl)); } catch { return false; }
}

const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Insert the theme into an HTML document. `cfg` must come from normalise()/DEFAULT.
export function injectTheme(html, cfg) {
  const theme = S.READY.includes(cfg.theme) ? cfg.theme : S.DEFAULT_THEME;
  const version = /^\d{1,15}$/.test(String(cfg.version)) ? String(cfg.version) : "0";
  const meta = S.THEMES.find((t) => t.id === theme);

  // 1. <html …> attributes (any existing data-theme* attribute is replaced)
  let done = false;
  html = html.replace(/<html\b([^>]*)>/i, (m, attrs) => {
    done = true;
    const clean = attrs.replace(/\sdata-theme(-version|-fallback)?\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
    return `<html${clean} data-theme="${escAttr(theme)}" data-theme-version="${version}">`;
  });
  if (!done) return html; // not a full document: leave it alone

  // 2. head additions: token overrides (validated values only), fonts, theme files
  const parts = [];
  const css = S.cssText(S.sanitizeTokens(cfg.tokens).css);
  if (css) parts.push(`<style id="ug-theme-tokens">${css.replace(/</g, "\\3c ")}</style>`);
  const fonts = S.fontHref(S.sanitizeTokens(cfg.tokens).tokens);
  if (fonts) parts.push(`<link id="ug-theme-fonts" rel="stylesheet" href="${escAttr(fonts)}">`);
  if (meta && meta.css) parts.push(`<link rel="stylesheet" href="/assets/themes/${theme}/theme.css?v=${version}" data-ug-theme-asset>`);
  if (meta && meta.js) parts.push(`<script src="/assets/themes/${theme}/shell.js?v=${version}" defer data-ug-theme-asset></script>`);
  if (parts.length) {
    const block = parts.join("");
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, block + "</head>") : html;
  }
  return html;
}

// Which requests may be HTML pages worth theming (cheap test before touching the response).
export function isPageRequest(url, method) {
  if (method !== "GET" && method !== "HEAD") return false;
  const p = url.pathname;
  if (p.startsWith("/api/") || p.startsWith("/assets/") || p.startsWith("/__ug/")) return false;
  return !/\.[a-z0-9]{1,8}$/i.test(p) || /\.html?$/i.test(p);
}

// Admin pages get the security headers but never a theme.
export function isThemedPath(url) {
  return !/^\/admin(\.html)?\/?$/i.test(url.pathname);
}
