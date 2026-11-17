// Shared server helpers for AI drafts (used by /api/auto-draft and the Telegram bot).
// This file has no request handler, so it is not a public endpoint.

import { writeArticle } from "./generate.js";

export const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
export const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Skip digests, podcasts, giveaways and deals: they don't make a single-band news story
export const NOT_NEWS = /\b(top (ten|10|five|5) stories|this week'?s|week in (review|metal)|round-?up|recap|podcast|episode \d|giveaway|contest|win (a|tickets)|deals? (on|for)|discount|on sale|% off|black friday|cyber monday|gift guide|poll:|quiz)\b/i;
export const isNews = (n) => !NOT_NEWS.test(String(n.title || "").replace(/[‘’]/g, "'"));

// Supabase REST with the service key. Returns { rest } or { error, seen }.
export function serviceRest(env) {
  const NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE", "SERVICE_ROLE_KEY"];
  const keyName = NAMES.find((n) => env[n] && String(env[n]).trim());
  if (!env.SUPABASE_URL || !keyName) {
    const seen = Object.keys(env).filter((k) => /SUPA|SERVICE|SECRET/i.test(k)); // names only, never values
    return { error: "The Supabase secret key is not set in Cloudflare Pages (Production). Add it as SUPABASE_SERVICE_ROLE_KEY and redeploy.", seen };
  }
  // New Supabase secret keys (sb_secret_…) go in the apikey header only; legacy service_role JWTs also as Bearer.
  const key = String(env[keyName]).trim();
  const sb = key.startsWith("sb_") ? { apikey: key, "content-type": "application/json" } : { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json" };
  const rest = (path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...sb, ...(init.headers || {}) } });
  return { rest };
}

// Text of the newest articles, to skip headlines already written up
// (every AI article keeps its "Source: [..](link)" line).
export async function usedLinks(rest) {
  try { return (await (await rest("articles?select=content&order=created_at.desc&limit=300")).json()).map((a) => a.content || "").join("\n"); } catch { return ""; }
}

export async function firstAdmin(rest) {
  try { return (await (await rest("admin_users?select=user_id&limit=1")).json())[0]?.user_id || null; } catch { return null; }
}

// Has the AI write one Scene Radar item and saves it as a DRAFT.
// Returns { ok:true, article:{id,title,slug}, a } or { ok:false, error }.
export async function writeDraftFromItem(env, rest, n, author) {
  const notes =
    `News item reported by ${n.source}${n.date ? " on " + new Date(n.date).toDateString() : ""}.\n` +
    `Headline: ${n.title}\n` + (n.summary ? `Summary: ${n.summary}\n` : "") +
    `The band name above was guessed from the headline; correct it in BAND if needed.\n` +
    `Write an original news piece in your own words based only on these facts. Do not copy the source's sentences. Mention that ${n.source} reported it.`;
  const band = n.band || n.title.split(/\s+/).slice(0, 3).join(" ");
  const out = await writeArticle(env, { band, category: "News", notes });
  if (out.status !== 200) return { ok: false, error: out.body.error || "The AI could not write this one." };
  const a = out.body;

  let category_id = null;
  try { category_id = (await (await rest(`categories?select=id&slug=eq.${encodeURIComponent(slugify(a.genre || "Underground"))}`)).json())[0]?.id || null; } catch {}
  let content = `${a.content}\n\nSource: [${n.source}](${n.link})`;
  if (a.youtube_url) content += "\n\n" + a.youtube_url;
  const now = new Date().toISOString();
  const row = {
    title: a.title, slug: slugify(a.title), excerpt: a.excerpt || "", content,
    band_name: a.band || band, album_name: a.release || "", genre: a.genre || "Underground", category_id,
    cover_image_url: /^https:\/\//.test(n.image || "") ? n.image : (a.cover_image_url || null),
    tags: Array.isArray(a.tags) ? a.tags : [], status: "draft",
    published_at: n.date || null, // the source's time is used when the editor publishes
    updated_at: now, author_id: author, kind: a.kind || "News", score: a.kind === "Review" ? a.score : null
  };
  const insert = (r) => rest("articles?select=id,title,slug", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(r) });
  let r = await insert(row);
  if (r.status === 409) { row.slug = row.slug.slice(0, 80) + "-" + Math.random().toString(36).slice(2, 6); r = await insert(row); } // slug taken
  if (!r.ok) { const t = await r.text(); if (/kind|score/i.test(t)) { delete row.kind; delete row.score; r = await insert(row); } else return { ok: false, error: t.slice(0, 200) }; }
  if (!r.ok) return { ok: false, error: (await r.text()).slice(0, 200) };
  const saved = (await r.json())[0];
  return { ok: true, article: saved, a, excerpt: row.excerpt, body: a.content, genre: row.genre };
}
