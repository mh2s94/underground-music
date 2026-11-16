// /a/<slug> — the article's own address. Serves the normal site (index.html) but with the
// article's title, description, share image and structured data in the <head>, so Google and
// link previews (WhatsApp, Instagram, X, Facebook) show the real story. The page itself then
// opens the article as usual.

const SITE = "https://music.mikasa.me";
const DEFAULT_IMAGE = SITE + "/assets/og.png";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (md) => String(md || "").replace(/^https?:\/\/\S+$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~]+/g, "").replace(/\s+/g, " ").trim();
const ytId = (s) => (String(s || "").match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/m) || [])[1] || "";

export async function onRequestGet({ request, env, params }) {
  const slug = decodeURIComponent(String(params.slug || "")).slice(0, 200);
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  let article = null;
  try { article = await findArticle(env, slug); } catch { /* fall back to the plain page */ }

  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=0, s-maxage=300");
  if (!article) return new Response(shell.body, { status: slug ? 404 : 200, headers });

  const url = `${SITE}/a/${encodeURIComponent(article.slug || article.id)}`;
  const title = `${article.title} — UNDERGROUND`;
  const desc = (article.excerpt || plain(article.content).slice(0, 180)).slice(0, 200);
  const vid = ytId(article.content);
  const image = /^https:\/\//.test(article.cover_image_url || "") ? article.cover_image_url : vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : DEFAULT_IMAGE;
  const ld = {
    "@context": "https://schema.org", "@type": "NewsArticle",
    headline: article.title.slice(0, 110), description: desc, image: [image],
    datePublished: article.published_at, dateModified: article.updated_at || article.published_at,
    mainEntityOfPage: url, articleSection: article.genre || "Underground",
    keywords: Array.isArray(article.tags) ? article.tags.join(", ") : undefined,
    about: article.band_name ? { "@type": "MusicGroup", name: article.band_name } : undefined,
    author: { "@type": "Organization", name: "UNDERGROUND Magazine", url: SITE },
    publisher: { "@type": "Organization", name: "UNDERGROUND Magazine", logo: { "@type": "ImageObject", url: SITE + "/assets/icon-512.png" } },
    articleBody: plain(article.content).slice(0, 5000)
  };
  const head = `
<link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="UNDERGROUND">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(article.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="article:published_time" content="${esc(article.published_at || "")}">
<meta property="article:section" content="${esc(article.genre || "Underground")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(article.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;

  const drop = { element(e) { e.remove(); } };
  const out = new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(title); } })
    .on('link[rel="canonical"]', drop)
    .on('meta[name="description"]', drop)
    .on('meta[property^="og:"]', drop)
    .on('meta[name^="twitter:"]', drop)
    .on("head", { element(e) { e.append(head, { html: true }); } })
    .transform(new Response(shell.body, { status: 200, headers }));
  return out;
}

async function findArticle(env, slug) {
  if (!slug || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const cols = "id,slug,title,excerpt,content,cover_image_url,genre,tags,band_name,published_at,updated_at";
  const h = { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + env.SUPABASE_ANON_KEY };
  const base = `${env.SUPABASE_URL}/rest/v1/articles?select=${cols}&status=eq.published&limit=1`;
  const q = /^[0-9a-f-]{36}$|^\d+$/i.test(slug) ? `&id=eq.${encodeURIComponent(slug)}` : `&slug=eq.${encodeURIComponent(slug)}`;
  const r = await fetch(base + q, { headers: h, signal: AbortSignal.timeout(5000) });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}
