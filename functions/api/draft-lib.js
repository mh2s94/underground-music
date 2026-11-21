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
  // Keep these public fallback credentials aligned with the browser client in admin.html.
  // They are publishable/anon credentials and can only read rows allowed by Supabase RLS.
  const FALLBACK_URL = "https://lhhmzfwjznlwkentbakv.supabase.co";
  const FALLBACK_PUBLIC_KEY = "sb_publishable_MQDqmSmPb3qiSODbBOSKmA_U7aBEFtN";
  const URL_NAMES = ["SUPABASE_URL", "SUPABASE_PROJECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"];
  const KEY_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE", "SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLIC_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PUBLIC_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"];
  const urlName = URL_NAMES.find((n) => env[n] && String(env[n]).trim());
  const keyName = KEY_NAMES.find((n) => env[n] && String(env[n]).trim());
  const projectUrl = supabaseProjectUrl(urlName ? env[urlName] : FALLBACK_URL);
  const key = String(keyName ? env[keyName] : FALLBACK_PUBLIC_KEY).trim();
  if (!projectUrl || !key) {
    const seen = Object.keys(env).filter((k) => /SUPA|SERVICE|SECRET|PUBLIC/i.test(k)); // names only, never values
    return { error: `Supabase public article read is not configured (URL: ${urlName || "frontend fallback"}; key: ${keyName || "frontend fallback"}). Set valid Supabase Pages variables or check the frontend fallback configuration.`, seen };
  }
  // New Supabase keys (sb_publishable_ / sb_secret_) go in the apikey header only; legacy JWT keys also as Bearer.
  const sb = key.startsWith("sb_") ? { apikey: key, "content-type": "application/json" } : { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json" };
  const rest = (path, init = {}) => fetch(`${projectUrl}/rest/v1/${path}`, { ...init, headers: { ...sb, ...(init.headers || {}) } });
  return { rest };
}

// Text of the newest articles, to skip headlines already written up
// (every AI article keeps its "Source: [..](link)" line).
export async function usedLinks(rest) {
  try { return (await (await rest("articles?select=content&order=created_at.desc&limit=300")).json()).map((a) => a.content || "").join("\n"); } catch { return ""; }
}
