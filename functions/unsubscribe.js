// /unsubscribe?t=<token> — removes a newsletter subscriber.
// GET only shows a confirmation page with a button: email security scanners (Outlook Safe Links,
// Gmail, corporate antivirus) open every link in an email, so a GET must never unsubscribe anyone.
// POST unsubscribes: from the button on that page (answers with a page), or from the one-click
// unsubscribe of email apps (RFC 8058, body "List-Unsubscribe=One-Click", answers with plain text).
import { applySecurityHeaders } from "./api/theme/edge.js";

const TOKEN_RE = /^[0-9a-f-]{36}$/i;
const page = (title, text, extra = "") => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — UNDERGROUND</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/bento.css?v=t2"></head>
<body style="overflow:auto"><main style="max-width:560px;margin:12vh auto;padding:24px;text-align:center"><h1 style="font:400 64px/.9 var(--display);margin:0 0 16px"><span class="neon-txt">${title}</span></h1><p style="color:var(--muted);font-size:17px;line-height:1.6">${text}</p>${extra}<p style="margin-top:28px"><a class="btn btn-forest" href="/">Back to UNDERGROUND</a></p></main></body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const INVALID = () => page("Link not valid", "This unsubscribe link is broken or incomplete. Email hello@mikasa.me and we will remove you by hand.");

async function unsubscribe(env, token) {
  if (!TOKEN_RE.test(token || "")) return null;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ug_unsubscribe`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ p_token: token })
  });
  return r.ok ? await r.json() : null;
}
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function onRequestGet({ request }) {
  const token = new URL(request.url).searchParams.get("t") || "";
  if (!TOKEN_RE.test(token)) return INVALID();
  return page("Unsubscribe?", "Press the button to stop receiving the UNDERGROUND newsletter.",
    `<form method="post" action="/unsubscribe?t=${encodeURIComponent(token)}" style="margin-top:24px"><button class="btn btn-white" type="submit">Unsubscribe</button></form>`);
}
export async function onRequestPost({ request, env }) {
  const token = new URL(request.url).searchParams.get("t");
  const body = await request.text().catch(() => "");
  const email = await unsubscribe(env, token);
  if (/List-Unsubscribe=One-Click/i.test(body)) return new Response("Unsubscribed", { status: 200 });
  // POST is not a page request for _middleware.js, so add the security headers here.
  const res = email === null ? INVALID() : page("Unsubscribed", email ? `${escHtml(email)} will no longer receive the UNDERGROUND newsletter. Changed your mind? Sign up again at the bottom of any page.` : "You are not on the list anymore. Nothing else to do.");
  applySecurityHeaders(res.headers);
  return res;
}
