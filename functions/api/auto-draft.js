// POST /api/auto-draft — called once a day by GitHub Actions (.github/workflows/auto-draft.yml).
// Picks the newest Scene Radar headlines that have not been written up yet, has the AI write
// each one (same generator as the admin's Auto-write) and saves them as DRAFTS for the editor
// to review and publish. Nothing is published automatically.
//
// Needs Cloudflare Pages secrets:
//   AUTODRAFT_TOKEN            shared with the GitHub Actions secret of the same name
//   SUPABASE_SERVICE_ROLE_KEY  lets the server save drafts: Supabase → Settings → API Keys →
//                              Secret keys (sb_secret_…) or the legacy service_role key
// Optional: AUTODRAFT_COUNT (default 2, max 3), AUTODRAFT_NOTIFY (email for a summary, uses Resend),
//           TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (each draft is also sent to the editor's Telegram).

import { same, serviceRest, usedLinks, firstAdmin, isNews, writeDraftFromItem } from "./draft-lib.js";
import { tgConfigured, sendDraftCard } from "./telegram/lib.js";

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.AUTODRAFT_TOKEN || !auth || !same(auth, env.AUTODRAFT_TOKEN)) return json({ error: "Not allowed." }, 401);
  const svc = serviceRest(env);
  if (svc.error) return json({ error: svc.error, variables_seen: svc.seen }, 503);
  const { rest } = svc;

  const url = new URL(request.url);
  const count = Math.max(1, Math.min(3, Number(url.searchParams.get("count") || env.AUTODRAFT_COUNT || 2)));

  // 1. Fresh headlines (same feed as Scene Radar)
  let items = [];
  try { items = ((await (await fetch(new URL("/api/news?refresh=1", url.origin))).json()).items) || []; } catch {}
  if (!items.length) return json({ error: "No headlines available right now." }, 502);

  // 2. Skip headlines already written up, digests, podcasts, giveaways and deals
  const used = await usedLinks(rest);
  const picks = items.filter((n) => n.link && !used.includes(n.link) && isNews(n)).slice(0, count);
  if (!picks.length) return json({ created: [], note: "Every recent headline has already been written up." });

  // 3. Author = the first administrator
  const author = await firstAdmin(rest);

  const created = [], failed = [];
  for (const n of picks) {
    const out = await writeDraftFromItem(env, rest, n, author);
    if (!out.ok) { failed.push({ headline: n.title, error: out.error }); continue; }
    created.push({ id: out.article.id, title: out.article.title, source: n.source, provider: out.a.provider });
    // Telegram: the same "Draft ready" card with Publish / Edit / Discard buttons
    if (tgConfigured(env)) await sendDraftCard(env, out, n).catch(() => {});
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
