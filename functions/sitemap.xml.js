import { serviceRest } from "./api/draft-lib.js";

const SITE = "https://music.mikasa.me";
const STATIC_ROUTES = ["/", "/articles", "/music", "/charts", "/search"];
const xml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export async function onRequestGet({ env }) {
  try {
    // Use the same server-side Supabase credentials and URL normalization as the
    // existing API endpoints. This remains a read-only PostgREST GET.
    const svc = serviceRest(env);
    if (svc.error) throw new Error(svc.error);
    const query = new URLSearchParams({
      select: "slug,published_at",
      status: "eq.published",
      order: "published_at.desc",
      limit: "1000"
    });
    const result = await svc.rest("articles?" + query.toString());
    if (!result.ok) throw new Error("Published articles query failed: " + (await result.text()).slice(0, 200));
    const rows = await result.json();
    if (!Array.isArray(rows)) throw new Error("Unexpected articles response");

    const urls = [
      ...STATIC_ROUTES.map((path) => `  <url><loc>${xml(SITE + path)}</loc></url>`),
      ...rows.filter((article) => article.slug).map((article) => {
        const lastmod = article.published_at && Number.isFinite(Date.parse(article.published_at))
          ? `<lastmod>${new Date(article.published_at).toISOString()}</lastmod>` : "";
        return `  <url><loc>${xml(SITE + "/a/" + encodeURIComponent(article.slug))}</loc>${lastmod}</url>`;
      })
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
    return new Response(body, { headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=900, s-maxage=900",
      "x-content-type-options": "nosniff"
    } });
  } catch {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><error>Sitemap temporarily unavailable.</error>', {
      status: 503, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
    });
  }
}
