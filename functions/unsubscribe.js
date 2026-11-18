// /unsubscribe?t=<token> — removes a newsletter subscriber.
// GET shows a confirmation page (and unsubscribes); POST supports one-click unsubscribe from email apps.
const page = (title, text) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — UNDERGROUND</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/bento.css?v=t2"></head>
<body style="overflow:auto"><main style="max-width:560px;margin:12vh auto;padding:24px;text-align:center"><h1 style="font:400 64px/.9 var(--display);margin:0 0 16px"><span class="neon-txt">${title}</span></h1><p style="color:var(--muted);font-size:17px;line-height:1.6">${text}</p><p style="margin-top:28px"><a class="btn btn-forest" href="/">Back to UNDERGROUND</a></p></main></body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

async function unsubscribe(env, token) {
  if (!/^[0-9a-f-]{36}$/i.test(token || "")) return null;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ug_unsubscribe`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ p_token: token })
  });
  return r.ok ? await r.json() : null;
}
export async function onRequestGet({ request, env }) {
  const email = await unsubscribe(env, new URL(request.url).searchParams.get("t"));
  if (email === null) return page("Link not valid", "This unsubscribe link is broken or incomplete. Email hello@mikasa.me and we will remove you by hand.");
  return page("Unsubscribed", email ? `${email.replace(/</g, "&lt;")} will no longer receive the UNDERGROUND newsletter. Changed your mind? Sign up again at the bottom of any page.` : "You are not on the list anymore. Nothing else to do.");
}
export async function onRequestPost({ request, env }) {
  await unsubscribe(env, new URL(request.url).searchParams.get("t"));
  return new Response("Unsubscribed", { status: 200 });
}
