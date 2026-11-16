// POST /api/newsletter/send (admin only)
// Body: { subject, intro, article_ids: [...], test: true|false }
// Builds a branded email with the chosen stories and sends it through Resend
// (https://resend.com, free: 3,000 emails/month, 100/day). Every email carries a
// personal one-click unsubscribe link.
// Needs Pages environment variables: RESEND_API_KEY and NEWSLETTER_FROM
// (e.g. "UNDERGROUND <news@mikasa.me>", on a domain verified in Resend).

import { isAal2, MFA_ERROR } from "../aal.js";
const SITE = "https://music.mikasa.me";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ytId = (s) => (String(s || "").match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/m) || [])[1] || "";

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Server is not configured." }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const sb = { apikey: env.SUPABASE_ANON_KEY, Authorization: auth };
  let me;
  try {
    const u = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: sb, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return json({ error: "Your session expired. Sign in again." }, 401);
    me = await u.json();
    const a = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(me.id)}`, { headers: sb });
    if (!a.ok || !(await a.json()).length) return json({ error: "Administrator access required." }, 403);
    if (!isAal2(request)) return json({ error: MFA_ERROR, mfa: true }, 403);
  } catch { return json({ error: "Could not verify your session." }, 502); }

  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM) {
    return json({ error: "Email sending is not set up yet. Add RESEND_API_KEY and NEWSLETTER_FROM in Cloudflare Pages → Settings → Variables and Secrets, then redeploy.", setup: true }, 503);
  }
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const subject = String(body.subject || "").trim().slice(0, 150);
  const intro = String(body.intro || "").trim().slice(0, 1500);
  const ids = (Array.isArray(body.article_ids) ? body.article_ids : []).map(String).slice(0, 8);
  if (!subject) return json({ error: "Add a subject." }, 400);
  if (!ids.length) return json({ error: "Pick at least one story." }, 400);

  // Stories
  const ar = await fetch(`${env.SUPABASE_URL}/rest/v1/articles?select=*&status=eq.published&id=in.(${ids.map(encodeURIComponent).join(",")})`, { headers: sb });
  if (!ar.ok) return json({ error: "Could not load the stories." }, 502);
  const byId = new Map((await ar.json()).map((a) => [String(a.id), a]));
  const stories = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!stories.length) return json({ error: "Those stories are not published." }, 400);

  // Recipients
  let recipients;
  if (body.test) recipients = [{ email: me.email, token: null }];
  else {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/newsletter_subscribers?select=email,token&order=created_at.asc&limit=5000`, { headers: sb });
    if (!r.ok) return json({ error: "Could not load subscribers. Run supabase/extras.sql (part 2) first." }, 502);
    recipients = await r.json();
  }
  if (!recipients.length) return json({ error: "No subscribers yet." }, 400);

  const html = (token) => emailHtml({ subject, intro, stories, unsub: token ? `${SITE}/unsubscribe?t=${token}` : `${SITE}/privacy.html` });
  const text = (token) => [subject, "", intro, "", ...stories.map((a) => `${a.title}\n${SITE}/a/${encodeURIComponent(a.slug || a.id)}\n`), token ? `Unsubscribe: ${SITE}/unsubscribe?t=${token}` : ""].join("\n");

  // Resend batch API: up to 100 emails per request
  let sent = 0; const errors = [];
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100).map((x) => ({
      from: env.NEWSLETTER_FROM, reply_to: env.NEWSLETTER_REPLY_TO || "hello@mikasa.me", to: [x.email], subject: (body.test ? "[Test] " : "") + subject,
      html: html(x.token), text: text(x.token),
      headers: x.token ? { "List-Unsubscribe": `<${SITE}/unsubscribe?t=${x.token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined
    }));
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" }, body: JSON.stringify(chunk)
    });
    if (r.ok) sent += chunk.length;
    else { const j = await r.json().catch(() => ({})); errors.push(j.message || j.error || ("HTTP " + r.status)); break; }
  }
  if (!sent) return json({ error: "Resend refused the emails: " + (errors[0] || "unknown error") }, 502);
  return json({ sent, total: recipients.length, errors });
}

function emailHtml({ subject, intro, stories, unsub }) {
  const card = (a) => {
    const v = ytId(a.content);
    const img = /^https:\/\//.test(a.cover_image_url || "") ? a.cover_image_url : v ? `https://i.ytimg.com/vi/${v}/hqdefault.jpg` : "";
    const url = `${SITE}/a/${encodeURIComponent(a.slug || a.id)}`;
    const score = a.score != null && a.kind === "Review" ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:6px;background:#2a1030;color:#FF5C86;font:700 12px monospace">${Number(a.score).toFixed(1)}/10</span>` : "";
    return `<tr><td style="padding:0 0 22px">
      ${img ? `<a href="${url}"><img src="${esc(img)}" width="560" alt="" style="display:block;width:100%;max-width:560px;border-radius:12px;border:0"></a>` : ""}
      <p style="margin:12px 0 4px;font:700 11px/1 monospace;letter-spacing:.1em;text-transform:uppercase;color:#A48FFF">${esc(a.kind || a.genre || "Story")}${score}</p>
      <a href="${url}" style="color:#F2EEFF;text-decoration:none;font:700 21px/1.25 Arial,sans-serif">${esc(a.title)}</a>
      ${a.excerpt ? `<p style="margin:8px 0 10px;color:#C9C2E8;font:15px/1.55 Arial,sans-serif">${esc(a.excerpt)}</p>` : ""}
      <a href="${url}" style="color:#FF5C86;font:700 13px Arial,sans-serif;text-decoration:none">Read the story →</a>
    </td></tr>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#050409;padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0E0C16;border:1px solid #2E2648;border-radius:16px">
<tr><td style="padding:28px 20px 8px">
  <a href="${SITE}" style="text-decoration:none;font:900 30px/1 Arial Black,Arial,sans-serif;letter-spacing:2px;color:#FFE3EC">UNDERGROUND</a>
  <p style="margin:6px 0 0;font:700 11px/1 monospace;letter-spacing:.14em;text-transform:uppercase;color:#7D769E">Independent extreme music magazine</p>
</td></tr>
<tr><td style="padding:16px 20px 6px">
  <h1 style="margin:0 0 10px;color:#F2EEFF;font:700 24px/1.25 Arial,sans-serif">${esc(subject)}</h1>
  ${intro ? `<p style="margin:0 0 18px;color:#C9C2E8;font:15px/1.6 Arial,sans-serif">${esc(intro).replace(/\n/g, "<br>")}</p>` : ""}
</td></tr>
<tr><td style="padding:6px 20px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stories.map(card).join("")}</table></td></tr>
<tr><td style="padding:8px 20px 26px;border-top:1px solid #221C36">
  <p style="margin:14px 0 0;color:#7D769E;font:12px/1.6 Arial,sans-serif">You get this because you subscribed on <a href="${SITE}" style="color:#A48FFF">music.mikasa.me</a>. Reply-to: hello@mikasa.me.<br>
  <a href="${unsub}" style="color:#A48FFF">Unsubscribe</a> · <a href="${SITE}/privacy.html" style="color:#A48FFF">Privacy</a></p>
</td></tr></table></td></tr></table></body></html>`;
}
