// Telegram helpers for the editor's bot. No request handler: not a public endpoint.
//
// Pages variables (Production):
//   TELEGRAM_BOT_TOKEN  secret  — from @BotFather
//   TELEGRAM_CHAT_ID    text    — the editor's chat ID (the bot tells you after /start)
// The webhook secret is derived from the bot token, so there is nothing else to set.

export const SITE = "https://music.mikasa.me";

export async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return data;
}

// Secret sent by Telegram in X-Telegram-Bot-Api-Secret-Token on every webhook call.
export async function webhookSecret(env) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ug-telegram-webhook:" + env.TELEGRAM_BOT_TOKEN));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Short stable key for a radar link (fits in callback_data).
export async function linkHash(link) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(link));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
