// Telegram helpers for the editor's bot. No request handler: not a public endpoint.
//
// Pages variables (Production):
//   TELEGRAM_BOT_TOKEN  secret  — from @BotFather
//   TELEGRAM_CHAT_ID    text    — the editor's chat ID (the bot tells you after /start)
// The webhook secret is derived from the bot token, so there is nothing else to set.

export const SITE = "https://music.mikasa.me";
export const tgConfigured = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

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

// Article markdown → plain text that fits in a Telegram message.
export function plain(md, max = 2600) {
  let t = String(md || "")
    .replace(/\n*Source: \[[^\]]*\]\([^)]*\)\s*$/m, "")
    .replace(/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\S*/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*(.+)$/gm, "▸ $1")
    .replace(/^>\s?/gm, "")
    .replace(/(\*\*|__|\*|_)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/\n{3,}/g, "\n\n").trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + " …";
  return t;
}

export const draftKeyboard = (id) => ({
  inline_keyboard: [
    [{ text: "🚀 Publish", callback_data: "p:" + id }],
    [{ text: "✏️ Edit di admin", url: `${SITE}/admin.html#edit=${encodeURIComponent(id)}` }, { text: "🗑 Buang draft", callback_data: "x:" + id }]
  ]
});
export const doneKeyboard = (label) => ({ inline_keyboard: [[{ text: label, callback_data: "n" }]] });

// "Draft ready" card. out = result of writeDraftFromItem, n = radar item.
export async function sendDraftCard(env, out, n) {
  const text =
    `✅ <b>Draft siap</b>\n\n<b>${esc(out.article.title)}</b>\n\n` +
    (out.excerpt ? `<i>${esc(out.excerpt)}</i>\n\n` : "") +
    `${esc(plain(out.body))}\n\n` +
    `<code>${esc(out.genre || "")}</code> · sumber: ${esc(n.source || "")}`;
  return tg(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "HTML",
    link_preview_options: { is_disabled: true }, reply_markup: draftKeyboard(out.article.id)
  });
}

// Short stable key for a radar link (fits in callback_data).
export async function linkHash(link) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(link));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
