// /band/<name> — band profile address. Serves the site with the band's name, description and
// photo in the <head> for Google and link previews; the page then renders the profile.

const SITE = "https://music.mikasa.me";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export async function onRequestGet({ request, env, params }) {
  const slug = safeDecode(String(params.slug || "")).slice(0, 120);
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=0, s-maxage=3600");
  if (!slug) return new Response(shell.body, { status: 404, headers });

  let name = titleCase(slug.replace(/[-_]+/g, " ").trim()), picture = null, unknownToDeezer = false;
  try {
    const r = await fetch(`https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    const a = (j.data || []).find((x) => norm(x.name) === norm(name));
    if (a) { name = a.name; if (a.picture_xl && !/\/artist\/\//.test(a.picture_xl)) picture = a.picture_xl; }
    else if (r.ok && Array.isArray(j.data)) unknownToDeezer = true;
  } catch {}
  // A band nobody knows (not on Deezer, no story, no song here) answers 404 so search engines don't
  // index empty profiles. The page itself still renders. Any doubt (errors, timeouts) keeps 200.
  const status = unknownToDeezer && (await notOnSite(env, slug)) ? 404 : 200;

  const url = `${SITE}/band/${encodeURIComponent(slug)}`;
  const desc = `${name} on UNDERGROUND: reviews, news, songs, ratings and top tracks.`;
  const image = picture || SITE + "/assets/og.png";
  const ld = { "@context": "https://schema.org", "@type": "MusicGroup", name, url, image, description: desc };
  const head = `
<link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="UNDERGROUND">
<meta property="og:type" content="profile">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(name)} — UNDERGROUND">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
  const drop = { element(e) { e.remove(); } };
  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(`${name} — UNDERGROUND`); } })
    .on('link[rel="canonical"]', drop).on('meta[name="description"]', drop)
    .on('meta[property^="og:"]', drop).on('meta[name^="twitter:"]', drop)
    .on("head", { element(e) { e.append(head, { html: true }); } })
    .transform(new Response(shell.body, { status, headers }));
}

// true only when Supabase answered and has no published story or song for this band
async function notOnSite(env, slug) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  const words = norm(slug).split(" ").filter(Boolean);
  if (!words.length) return false;
  const like = encodeURIComponent("*" + words.join("*") + "*");
  const h = { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + env.SUPABASE_ANON_KEY };
  const base = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/";
  try {
    const [a, t] = await Promise.all([
      fetch(`${base}articles?select=id&status=eq.published&band_name=ilike.${like}&limit=1`, { headers: h, signal: AbortSignal.timeout(3000) }),
      fetch(`${base}tracks?select=id&artist=ilike.${like}&limit=1`, { headers: h, signal: AbortSignal.timeout(3000) })
    ]);
    if (!a.ok || !t.ok) return false;
    return !(await a.json()).length && !(await t.json()).length;
  } catch { return false; }
}
