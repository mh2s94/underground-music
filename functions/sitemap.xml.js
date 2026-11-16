// /sitemap.xml — tells search engines about the home page, legal pages and every published article.
const SITE = "https://music.mikasa.me";
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function onRequestGet({ env }) {
  let rows = [];
  try {
    const h = { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + env.SUPABASE_ANON_KEY };
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/articles?select=id,slug,published_at,updated_at&status=eq.published&order=published_at.desc&limit=5000`, { headers: h, signal: AbortSignal.timeout(8000) });
    if (r.ok) rows = await r.json();
  } catch {}
  const urls = [
    { loc: SITE + "/", lastmod: rows[0]?.published_at, freq: "daily", pri: "1.0" },
    ...rows.map((a) => ({ loc: `${SITE}/a/${encodeURIComponent(a.slug || a.id)}`, lastmod: a.updated_at || a.published_at, freq: "weekly", pri: "0.8" })),
    { loc: SITE + "/privacy.html", freq: "yearly", pri: "0.2" },
    { loc: SITE + "/terms.html", freq: "yearly", pri: "0.2" }
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${x(u.loc)}</loc>${u.lastmod ? `<lastmod>${x(new Date(u.lastmod).toISOString())}</lastmod>` : ""}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join("\n")}
</urlset>`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600, s-maxage=3600" } });
}
