// Runs in front of every request that _routes.json sends to Functions (everything except /assets/*
// and a few static files). For HTML pages it applies the active theme and the security headers
// (see functions/api/theme/edge.js). Everything else passes through untouched.
// It never breaks a page: on any error the original response is returned with the security headers.
// It also permanently moves the old production alias (underground-music.pages.dev) to music.mikasa.me,
// so crawlers and deep links never see two copies of the site.

import { isPageRequest, isThemedPath, readActiveTheme, injectTheme, applySecurityHeaders, DEFAULT } from "./api/theme/edge.js";

// Pages answers every path that matches no asset or Function with index.html and status 200 (the SPA
// fallback). For /search that is wanted; for a typo it is a "soft 404" that wastes crawl budget.
// These are the paths the site really owns — everything else gets a real 404 (still themed).
const KNOWN_EXACT = new Set([
  "/", "/index.html", "/search",
  "/privacy", "/privacy.html", "/terms", "/terms.html",
  "/admin", "/admin.html", "/unsubscribe",
  "/sitemap.xml", "/rss.xml", "/robots.txt", "/manifest.webmanifest", "/favicon.ico"
]);
const KNOWN_PREFIX = ["/a/", "/band/", "/api/", "/assets/", "/data/"];
export function isKnownPath(pathname) {
  const p = pathname === "/" ? "/" : pathname.replace(/\/+$/, "") || "/";
  return KNOWN_EXACT.has(p) || KNOWN_PREFIX.some((prefix) => p.startsWith(prefix));
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Canonical address: music.mikasa.me. Match the exact production alias only, so preview
  // deployments (<hash>.underground-music.pages.dev) and *.pages.dev keep working untouched.
  if (url.hostname === "underground-music.pages.dev") {
    url.hostname = "music.mikasa.me";
    return Response.redirect(url.toString(), 301);
  }

  if (!isPageRequest(url, request.method)) return context.next();

  // Ask for the full page, never a 304: the cached copy in the browser may carry an older theme.
  const h = new Headers(request.headers);
  h.delete("if-none-match");
  h.delete("if-modified-since");
  const res = await context.next(new Request(request, { headers: h }));

  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  // The SPA fallback gives every unknown path index.html with status 200. Report it honestly as a
  // 404 so crawlers drop typos and dead links instead of indexing the homepage under many URLs.
  const status = res.status === 200 && !isKnownPath(url.pathname) ? 404 : res.status;

  const headers = new Headers(res.headers);
  applySecurityHeaders(headers);
  const passthrough = () => new Response(res.body, { status, statusText: res.statusText, headers });

  // Theme every real page, including "not found" pages (an unknown /a/ slug still shows the site);
  // redirects, errors from the server and admin pages are passed through with headers only.
  const themable = status === 200 || (status >= 400 && status < 500);
  if (request.method === "HEAD" || !themable || !isThemedPath(url)) return passthrough();

  let html;
  try { html = await res.text(); } catch { return new Response(null, { status: 502, headers }); }

  let cfg = DEFAULT;
  try { cfg = await readActiveTheme(context.env, request.url, { waitUntil: context.waitUntil?.bind(context) }); } catch { cfg = DEFAULT; }

  let out = html;
  try { out = injectTheme(html, cfg); } catch { out = html; cfg = DEFAULT; }

  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  // Browsers must ask again every time (no stale theme); keep no-store where a page asked for it.
  if (!/no-store/i.test(headers.get("cache-control") || "")) headers.set("cache-control", "public, max-age=0, must-revalidate");
  headers.set("x-ug-theme", `${cfg.theme}@${cfg.version};${cfg.source || "default"}`);
  return new Response(out, { status, statusText: res.statusText, headers });
}
