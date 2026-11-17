// POST /api/telegram/webhook — Telegram calls this for messages and button presses.
// Security:
//   1. The X-Telegram-Bot-Api-Secret-Token header must match (derived from the bot token).
//   2. Only TELEGRAM_CHAT_ID is obeyed; everyone else is ignored (except /start, which
//      only tells the sender their own chat ID so the owner can set it up).
//   3. The bot can only write drafts, publish drafts and discard drafts. It cannot edit,
//      unpublish or delete published articles, or touch anything else.
// Retries: a button press is claimed in the database first, so a repeated delivery does nothing.

import { serviceRest, firstAdmin, writeDraftFromItem, same } from "../draft-lib.js";
import { SITE, tg, esc, webhookSecret, sendDraftCard, doneKeyboard } from "./lib.js";

const OK = () => new Response("ok");
const UUIDISH = /^[0-9a-zA-Z-]{1,40}$/;

export async function onRequestPost({ request, env }) {
  if (!env.TELEGRAM_BOT_TOKEN) return new Response("Not configured", { status: 503 });
  const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!same(got, await webhookSecret(env))) return new Response("Forbidden", { status: 403 });

  let u;
  try { u = await request.json(); } catch { return OK(); }
  const owner = String(env.TELEGRAM_CHAT_ID || "");

  // Text messages: /start and help
  if (u.message) {
    const chat = String(u.message.chat?.id || "");
    const text = String(u.message.text || "");
    if (!owner) {
      if (/^\/(start|id)\b/.test(text)) await tg(env, "sendMessage", { chat_id: chat, text: `ID chat kamu: <code>${esc(chat)}</code>\nSimpan sebagai TELEGRAM_CHAT_ID di Cloudflare Pages, lalu redeploy.`, parse_mode: "HTML" });
      return OK();
    }
    if (chat !== owner) return OK(); // strangers are ignored
    await tg(env, "sendMessage", { chat_id: chat, text: "🤘 Bot UNDERGROUND aktif.\nRingkasan Scene Radar dikirim 3x sehari (08.00, 14.00, 20.00 WIT). Tekan ✍️ Tulis draft pada berita yang mau ditulis AI." });
    return OK();
  }

  const q = u.callback_query;
  if (!q) return OK();
  if (!owner || String(q.from?.id) !== owner || String(q.message?.chat?.id) !== owner) {
    await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: "Tidak diizinkan." });
    return OK();
  }
  const [act, key] = String(q.data || "").split(":");
  const msg = { chat_id: owner, message_id: q.message.message_id };
  const answer = (text) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });
  const label = (t) => tg(env, "editMessageReplyMarkup", { ...msg, reply_markup: doneKeyboard(t) });
  if (act === "n" || !key || !UUIDISH.test(key)) { await answer(); return OK(); }

  const svc = serviceRest(env);
  if (svc.error) { await answer("Server belum dikonfigurasi."); return OK(); }
  const { rest } = svc;
  // PATCH that only succeeds from an expected state; returns the updated rows.
  const claim = async (path, body) => {
    const r = await rest(path, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
    return r.ok ? await r.json() : [];
  };

  if (act === "s") { // Abaikan
    await claim(`telegram_radar?hash=eq.${key}&status=eq.sent`, { status: "skipped", updated_at: new Date().toISOString() });
    await answer("Diabaikan");
    await label("✖ Diabaikan");
    return OK();
  }

  if (act === "d") { // Tulis draft
    // "writing" older than 3 minutes = an earlier attempt was cut off, so it may be claimed again
    const stale = new Date(Date.now() - 180000).toISOString();
    const rows = await claim(`telegram_radar?hash=eq.${key}&or=(status.eq.sent,and(status.eq.writing,updated_at.lt.${stale}))`, { status: "writing", updated_at: new Date().toISOString() });
    if (!rows.length) { await answer("Berita ini sudah diproses."); return OK(); }
    await answer("Menulis draft… (sekitar 30 detik)");
    await label("⏳ Menulis…");
    const n = rows[0].item || {};
    const out = await writeDraftFromItem(env, rest, n, await firstAdmin(rest));
    if (!out.ok) {
      await claim(`telegram_radar?hash=eq.${key}&status=eq.writing`, { status: "sent", updated_at: new Date().toISOString() });
      await tg(env, "editMessageReplyMarkup", { ...msg, reply_markup: { inline_keyboard: [[{ text: "✍️ Coba lagi", callback_data: "d:" + key }, { text: "✖ Abaikan", callback_data: "s:" + key }]] } });
      await tg(env, "sendMessage", { chat_id: owner, text: "⚠️ Gagal menulis draft: " + String(out.error || "").slice(0, 300) });
      return OK();
    }
    await claim(`telegram_radar?hash=eq.${key}&status=eq.writing`, { status: "drafted", article_id: String(out.article.id), updated_at: new Date().toISOString() });
    await label("✅ Draft dibuat");
    await sendDraftCard(env, out, n);
    return OK();
  }

  if (act === "p") { // Publish (drafts only)
    const now = new Date().toISOString();
    const r = await rest(`articles?select=id,slug,published_at&id=eq.${key}&status=eq.draft`);
    const a = r.ok ? (await r.json())[0] : null;
    if (!a) { await answer("Draft tidak ditemukan atau sudah tayang."); await label("—"); return OK(); }
    const rows = await claim(`articles?id=eq.${key}&status=eq.draft&select=id,slug`, { status: "published", published_at: a.published_at || now, updated_at: now });
    if (!rows.length) { await answer("Gagal publish."); return OK(); }
    await answer("Tayang!");
    await label("✅ Published");
    await tg(env, "sendMessage", { chat_id: owner, text: `🚀 <b>Tayang!</b>\n${SITE}/a/${encodeURIComponent(rows[0].slug || rows[0].id)}`, parse_mode: "HTML" });
    return OK();
  }

  if (act === "x") { // Buang draft (drafts only)
    const r = await rest(`articles?id=eq.${key}&status=eq.draft`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    const gone = r.ok ? (await r.json()).length : 0;
    await answer(gone ? "Draft dibuang" : "Draft tidak ditemukan atau sudah tayang.");
    await label(gone ? "🗑 Dibuang" : "—");
    return OK();
  }

  await answer();
  return OK();
}
