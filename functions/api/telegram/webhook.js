// POST /api/telegram/webhook — Telegram calls this for messages.
// The bot only sends the Scene Radar digest; it writes, publishes or changes nothing.
// Security: the X-Telegram-Bot-Api-Secret-Token header must match (derived from the bot token),
// and only TELEGRAM_CHAT_ID gets an answer (except /start before setup, which tells the sender their chat ID).

import { same } from "../draft-lib.js";
import { tg, esc, webhookSecret } from "./lib.js";

const OK = () => new Response("ok");

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
    await tg(env, "sendMessage", { chat_id: chat, text: "🤘 Bot UNDERGROUND aktif.\nRingkasan Scene Radar dikirim 3x sehari (08.00, 14.00, 20.00 WIT) sebagai info. Buka link sumber untuk membaca beritanya." });
    return OK();
  }

  // Buttons from older messages (Tulis draft, Publish, ...) were removed: answer and do nothing
  const q = u.callback_query;
  if (q) await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: "Tombol ini sudah tidak dipakai." });
  return OK();
}
