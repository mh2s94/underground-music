// POST /api/theme/refresh — called by the Theme Manager right after Apply / Restore / Reset.
// Clears the cached active theme at this edge location and reads it again, so the change shows in
// seconds here; other locations pick it up within CACHE_TTL (30 s) on their own.
// Only for admins with two-step verification (same checks as /api/generate). It changes nothing in
// the database: Apply itself is ug_apply_theme(), called by the browser under RLS.

import { isAal2, MFA_ERROR } from "../aal.js";
import { purgeActiveTheme, readActiveTheme, supabaseConfig } from "./edge.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
});

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: "Sign in required." }, 401);
  const { url, key } = supabaseConfig(env);
  const headers = { apikey: key, Authorization: auth };
  try {
    const u = await fetch(url + "/auth/v1/user", { headers, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
    const user = await u.json();
    const a = await fetch(url + "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(user.id), { headers, signal: AbortSignal.timeout(8000) });
    if (!a.ok || !(await a.json()).length) return json({ error: "Administrator access required." }, 403);
    if (!isAal2(request)) return json({ error: MFA_ERROR, mfa: true }, 403);
    return null;
  } catch {
    return json({ error: "Could not verify your session. Try again." }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const purged = await purgeActiveTheme(request.url);
  const now = await readActiveTheme(env, request.url, { bypassCache: true });
  return json({ ok: true, purged, theme: now.theme, version: now.version, source: now.source });
}

export function onRequestGet() {
  return json({ error: "Use POST." }, 405);
}
