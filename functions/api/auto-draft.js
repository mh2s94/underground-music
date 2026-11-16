// POST /api/auto-draft — called once a day by GitHub Actions (.github/workflows/auto-draft.yml).
// Picks the newest Scene Radar headlines that have not been written up yet, has the AI write
// each one (same generator as the admin's Auto-write) and saves them as DRAFTS for the editor
// to review and publish. Nothing is published automatically.
//
// Needs Cloudflare Pages secrets:
//   AUTODRAFT_TOKEN            shared with the GitHub Actions secret of the same name
//   SUPABASE_SERVICE_ROLE_KEY  lets the server save drafts: Supabase → Settings → API Keys →
//                              Secret keys (sb_secret_…) or the legacy service_role key
// Optional: AUTODRAFT_COUNT (default 2, max 3), AUTODRAFT_NOTIFY (email for a summary, uses Resend).

import { writeArticle } from "./generate.js";

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.AUTODRAFT_TOKEN || !auth || !same(auth, env.AUTODRAFT_TOKEN)) return json({ error: "Not allowed." }, 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set in Cloudflare Pages." }, 503);

  const url = new URL(request.url);
  const count = Math.max(1, Math.min(3, Number(url.searchParams.get("count") || env.AUTODRAFT_COUNT || 2)));
  // New Supabase secret keys (sb_secret_…) go in the apikey header only; legacy service_role JWTs also as Bearer.
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const sb = key.startsWith("sb_") ? { apikey: key, "content-type": "application/json" } : { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json" };
  const rest = (path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...sb, ...(init.headers || {}) } });

  // 1. Fresh headlines (same feed as Scene Radar)
  let items = [];
  try { items = ((await (await fetch(new URL("/api/news?refresh=1", url.origin))).json()).items) || []; } catch {}
  if (!items.length) return json({ error: "No headlines available right now." }, 502);

  // 2. Skip headlines already written up (every AI article keeps its "Source: [..](link)" line)
  let used = "";
  try { used = (await (await rest("articles?select=content&order=created_at.desc&limit=300")).json()).map((a) => a.content || "").join("\n"); } catch {}
  const picks = items.filter((n) => n.link && !used.includes(n.link)).slice(0, count);
  if (!picks.length) return json({ created: [], note: "Every recent headline has already been written up." });

  // 3. Author = the first administrator
  let author = null;
  try { author = (await (await rest("admin_users?select=user_id&limit=1")).json())[0]?.user_id || null; } catch {}

  const created = [], failed = [];
  for (const n of picks) {
    const notes =
      `News item reported by ${n.source}${n.date ? " on " + new Date(n.date).toDateString() : ""}.\n` +
      `Headline: ${n.title}\n` + (n.summary ? `Summary: ${n.summary}\n` : "") +
      `The band name above was guessed from the headline; correct it in BAND if needed.\n` +
      `Write an original news piece in your own words based only on these facts. Do not copy the source's sentences. Mention that ${n.source} reported it.`;
    const band = n.band || n.title.split(/\s+/).slice(0, 3).join(" ");
    const out = await writeArticle(env, { band, category: "News", notes });
    if (out.status !== 200) { failed.push({ headline: n.title, error: out.body.error }); continue; }
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
    if (!r.ok) { const t = await r.text(); if (/kind|score/i.test(t)) { delete row.kind; delete row.score; r = await insert(row); } else { failed.push({ headline: n.title, error: t.slice(0, 200) }); continue; } }
    if (!r.ok) { failed.push({ headline: n.title, error: (await r.text()).slice(0, 200) }); continue; }
    const saved = (await r.json())[0];
    created.push({ id: saved.id, title: saved.title, source: n.source, provider: a.provider });
  }

  // 4. Optional email to the editor
  if (created.length && env.RESEND_API_KEY && env.NEWSLETTER_FROM && env.AUTODRAFT_NOTIFY) {
    const list = created.map((c) => `• ${c.title} (${c.source})`).join("\n");
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: env.NEWSLETTER_FROM, to: [env.AUTODRAFT_NOTIFY], subject: `${created.length} new draft${created.length > 1 ? "s" : ""} to review`, text: `Good morning! The AI wrote these drafts from today's headlines:\n\n${list}\n\nReview and publish: https://music.mikasa.me/admin.html` })
    }).catch(() => {});
  }
  return json({ created, failed }, created.length ? 200 : 502);
}
