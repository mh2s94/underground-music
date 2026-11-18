// Runs in front of every request that _routes.json sends to Functions (everything except /assets/*
// and a few static files). For HTML pages it applies the active theme and the security headers
// (see functions/api/theme/edge.js). Everything else passes through untouched.
// It never breaks a page: on any error the original response is returned with the security headers.

import { isPageRequest, isThemedPath, readActiveTheme, injectTheme, applySecurityHeaders, DEFAULT } from "./api/theme/edge.js";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (!isPageRequest(url, request.method)) return context.next();

  // Ask for the full page, never a 304: the cached copy in the browser may carry an older theme.
  const h = new Headers(request.headers);
  h.delete("if-none-match");
  h.delete("if-modified-since");
  const res = await context.next(new Request(request, { headers: h }));

  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  const headers = new Headers(res.headers);
  applySecurityHeaders(headers);
  const passthrough = () => new Response(res.body, { status: res.status, statusText: res.statusText, headers });

  // Theme every real page, including "not found" pages (an unknown /a/ slug still shows the site);
  // redirects, errors from the server and admin pages are passed through with headers only.
  const themable = res.status === 200 || (res.status >= 400 && res.status < 500);
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
  return new Response(out, { status: res.status, statusText: res.statusText, headers });
}
