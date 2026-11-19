// Shared server helpers for the Telegram digest (token check, news filter, Supabase REST).
// This file has no request handler, so it is not a public endpoint.

export const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Skip digests, podcasts, giveaways and deals: they don't make a single-band news story
export const NOT_NEWS = /\b(top (ten|10|five|5) stories|this week'?s|week in (review|metal)|round-?up|recap|podcast|episode \d|giveaway|contest|win (a|tickets)|deals? (on|for)|discount|on sale|% off|black friday|cyber monday|gift guide|poll:|quiz)\b/i;
export const isNews = (n) => !NOT_NEWS.test(String(n.title || "").replace(/[‘’]/g, "'"));

// Normalize the project URL. Cloudflare values accidentally saved with /rest/v1
// must not produce /rest/v1/rest/v1/... (PostgREST responds with PGRST125).
export function supabaseProjectUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    const path = url.pathname.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
    if (path) return "";
    return url.origin;
  } catch { return ""; }
}

// Supabase REST with the service key. Returns { rest } or { error, seen }.
export function serviceRest(env) {
  const NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE", "SERVICE_ROLE_KEY"];
  const keyName = NAMES.find((n) => env[n] && String(env[n]).trim());
  const projectUrl = supabaseProjectUrl(env.SUPABASE_URL);
  if (!projectUrl || !keyName) {
    const seen = Object.keys(env).filter((k) => /SUPA|SERVICE|SECRET/i.test(k)); // names only, never values
    return { error: "The Supabase secret key is not set in Cloudflare Pages (Production). Add it as SUPABASE_SERVICE_ROLE_KEY and redeploy.", seen };
  }
  // New Supabase secret keys (sb_secret_…) go in the apikey header only; legacy service_role JWTs also as Bearer.
  const key = String(env[keyName]).trim();
  const sb = key.startsWith("sb_") ? { apikey: key, "content-type": "application/json" } : { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json" };
  const rest = (path, init = {}) => fetch(`${projectUrl}/rest/v1/${path}`, { ...init, headers: { ...sb, ...(init.headers || {}) } });
  return { rest };
}

// Text of the newest articles, to skip headlines already written up
// (every AI article keeps its "Source: [..](link)" line).
export async function usedLinks(rest) {
  try { return (await (await rest("articles?select=content&order=created_at.desc&limit=300")).json()).map((a) => a.content || "").join("\n"); } catch { return ""; }
}
