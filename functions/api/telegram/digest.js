// POST /api/telegram/digest — called 3x a day by GitHub Actions (.github/workflows/telegram-digest.yml).
// Sends the editor the top Scene Radar headlines that are not written up and not sent before,
// each with [Tulis draft] [Abaikan] buttons. Also (re)registers the bot's webhook.
// Auth: Authorization: Bearer <AUTODRAFT_TOKEN>. Optional ?count=1..8 (default 5).

import { same, serviceRest, usedLinks, isNews } from "../draft-lib.js";
import { SITE, tg, esc, webhookSecret, linkHash } from "./lib.js";

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.AUTODRAFT_TOKEN || !auth || !same(auth, env.AUTODRAFT_TOKEN)) return json({ error: "Not allowed." }, 401);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN is not set in Cloudflare Pages (Production)." }, 503);

  // 1. Make sure Telegram sends button presses to this site
  const hook = `${SITE}/api/telegram/webhook`;
  const info = await tg(env, "getWebhookInfo", {});
  if (!info.ok) return json({ error: "Telegram rejected the bot token.", telegram: info.description || null }, 502);
  let webhook = "ok";
  if (info.result?.url !== hook) {
    const set = await tg(env, "setWebhook", { url: hook, secret_token: await webhookSecret(env), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    webhook = set.ok ? "registered" : "failed: " + (set.description || "unknown");
  }
  if (!env.TELEGRAM_CHAT_ID) return json({ webhook, note: "Now send /start to your bot in Telegram: it replies with your chat ID. Save it as TELEGRAM_CHAT_ID and redeploy." });

  const svc = serviceRest(env);
  if (svc.error) return json({ error: svc.error, variables_seen: svc.seen }, 503);
  const { rest } = svc;
  const count = Math.max(1, Math.min(8, Number(new URL(request.url).searchParams.get("count") || 5)));

  // 2. Candidates: newest headlines, not written up yet, real news
  let items = [];
  try { items = ((await (await fetch(new URL("/api/news?refresh=1", request.url))).json()).items) || []; } catch {}
  if (!items.length) return json({ webhook, error: "No headlines available right now." }, 502);
  const used = await usedLinks(rest);
  const fresh = items.filter((n) => n.link && !used.includes(n.link) && isNews(n)).slice(0, 40);
  for (const n of fresh) n.hash = await linkHash(n.link);

  // 3. Skip what the bot already sent
  let sent = new Set();
  if (fresh.length) {
    const r = await rest(`telegram_radar?select=hash&hash=in.(${fresh.map((n) => n.hash).join(",")})`);
    if (!r.ok) return json({ webhook, error: "The telegram_radar table is missing. Run supabase/telegram.sql in Supabase → SQL Editor.", detail: (await r.text()).slice(0, 200) }, 503);
    sent = new Set((await r.json()).map((x) => x.hash));
  }
  const picks = fresh.filter((n) => !sent.has(n.hash)).slice(0, count);
  if (!picks.length) return json({ webhook, sent: 0, note: "No new headlines since the last digest." });

  // 4. Remember them, then send: one header + one message per headline (each with its own buttons)
  const rows = picks.map((n) => ({
    hash: n.hash, link: n.link, title: n.title, status: "sent",
    item: { title: n.title, link: n.link, source: n.source, summary: n.summary || "", date: n.date || null, image: n.image || null, band: n.band || null, genres: n.genres || [] }
  }));
  const ins = await rest("telegram_radar", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(rows) });
  if (!ins.ok) return json({ webhook, error: "Could not save to telegram_radar.", detail: (await ins.text()).slice(0, 200) }, 502);

  const when = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jayapura", hour: "2-digit", minute: "2-digit" }).format(new Date());
  await tg(env, "sendMessage", { chat_id: env.TELEGRAM_CHAT_ID, text: `🆕 <b>Scene Radar · ${picks.length} berita teratas</b>\nRingkasan pukul ${when} WIT`, parse_mode: "HTML" });
  let ok = 0;
  for (const [i, n] of picks.entries()) {
    const text =
      `<b>${i + 1}. ${esc(n.title)}</b>\n` +
      `${esc(n.source)}${n.genres?.length ? " · " + esc(n.genres.join(", ")) : ""} · <a href="${esc(n.link)}">sumber ↗</a>` +
      (n.summary ? `\n\n${esc(String(n.summary).slice(0, 300))}` : "");
    const r = await tg(env, "sendMessage", {
      chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "✍️ Tulis draft", callback_data: "d:" + n.hash }, { text: "✖ Abaikan", callback_data: "s:" + n.hash }]] }
    });
    if (r.ok) ok++;
  }
  return json({ webhook, sent: ok });
}
