// /band/<slug> — SEO shell for the article-backed band directory.
// The profile UI loads published stories from public.articles in the browser using SELECT only.
// This route intentionally performs no database, RPC, or third-party API requests.
const SITE = "https://music.mikasa.me";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export async function onRequestGet({ request, env, params }) {
  const slug = safeDecode(String(params.slug || "")).slice(0, 120).replace(/[^a-zA-Z0-9-]/g, "");
  if (!slug) return new Response("Not found", { status: 404 });
  const name = titleCase(slug.replace(/-+/g, " ").trim());
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=0, s-maxage=900");
  const url = SITE + "/band/" + encodeURIComponent(slug);
  const desc = "Published stories and videos featuring " + name + " on UNDERGROUND Magazine.";
  const head = `
<link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="UNDERGROUND">
<meta property="og:type" content="profile">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(name)} — UNDERGROUND">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/assets/og.png">`;
  const drop = { element(e) { e.remove(); } };
  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(name + " — UNDERGROUND"); } })
    .on('link[rel="canonical"]', drop).on('meta[name="description"]', drop)
    .on('meta[property^="og:"]', drop).on('meta[name^="twitter:"]', drop)
    .on("head", { element(e) { e.append(head, { html: true }); } })
    .transform(new Response(shell.body, { status: 200, headers }));
}
