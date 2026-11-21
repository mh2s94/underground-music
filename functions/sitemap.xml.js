import { serviceRest } from "./api/draft-lib.js";

const SITE = "https://music.mikasa.me";
const STATIC_ROUTES = ["/", "/articles", "/music", "/charts", "/search"];
const xml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const headers = {
  "content-type": "application/xml; charset=utf-8",
  "cache-control": "public, max-age=900, s-maxage=900",
  "x-content-type-options": "nosniff"
};

function sitemap(rows = []) {
  const urls = [
    ...STATIC_ROUTES.map((path) => `  <url><loc>${xml(SITE + path)}</loc></url>`),
    ...rows.filter((article) => article.slug).map((article) => {
      const lastmod = article.published_at && Number.isFinite(Date.parse(article.published_at))
        ? `<lastmod>${new Date(article.published_at).toISOString()}</lastmod>` : "";
      return `  <url><loc>${xml(SITE + "/a/" + encodeURIComponent(article.slug))}</loc>${lastmod}</url>`;
    })
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

function errorResponse(message, status = 503) {
  const safe = String(message || "Unknown Supabase error").replace(/[<>\r\n]/g, " ").slice(0, 300);
  console.error("[sitemap.xml] " + safe);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><error status="${status}">${xml(safe)}</error>`, {
    status, headers: { ...headers, "cache-control": "no-store" }
  });
}

export async function onRequestGet({ env }) {
  const svc = serviceRest(env);
  if (svc.error) {
    // Preview deployments without Supabase secrets still expose a useful core sitemap.
    console.error("[sitemap.xml] " + svc.error);
    return new Response(sitemap(), { status: 200, headers: { ...headers, "x-sitemap-source": "static-fallback" } });
  }

  try {
    // Match the published-article PostgREST contract: status=eq.published,
    // ordered by published_at, with the same slug/published_at fields as RSS.
    const query = new URLSearchParams({
      select: "slug,published_at",
      status: "eq.published",
      order: "published_at.desc",
      limit: "1000"
    });
    const result = await svc.rest("articles?" + query.toString(), { signal: AbortSignal.timeout(8000) });
    if (!result.ok) {
      const detail = (await result.text()).slice(0, 240);
      return errorResponse(`Supabase HTTP ${result.status} ${result.statusText}: ${detail}`, result.status >= 400 && result.status < 600 ? result.status : 502);
    }
    const rows = await result.json();
    if (!Array.isArray(rows)) return errorResponse("Supabase returned a non-array response for public.articles", 502);
    return new Response(sitemap(rows), { headers });
  } catch (error) {
    return errorResponse(error?.message || String(error), 502);
  }
}
