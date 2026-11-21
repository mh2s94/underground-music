import { serviceRest } from "./api/draft-lib.js";

const SITE = "https://music.mikasa.me";
const DEFAULT_IMAGE = SITE + "/assets/og.png";
const xml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const plain = (value) => String(value ?? "").replace(/^https?:\/\/\S+$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[#>*_`~]+/g, "").replace(/\s+/g, " ").trim();
const validHttpUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
};
const validVideoId = (value) => /^[A-Za-z0-9_-]{11}$/.test(String(value || ""));
const response = (body, status = 200) => new Response(body, {
  status,
  headers: {
    "content-type": "application/rss+xml; charset=utf-8",
    "cache-control": status === 200 ? "public, max-age=900, s-maxage=900" : "no-store",
    "x-content-type-options": "nosniff"
  }
});

export async function onRequestGet({ env }) {
  try {
    const rows = await latestArticles(env);
    const items = rows.map((article) => {
      const link = SITE + "/a/" + encodeURIComponent(article.slug || article.id);
      const image = validHttpUrl(article.cover_image_url) ||
        (validVideoId(article.youtube_video_id) ? `https://i.ytimg.com/vi/${article.youtube_video_id}/hqdefault.jpg` : DEFAULT_IMAGE);
      const description = article.excerpt || plain(article.content).slice(0, 240);
      const pubDate = article.published_at && Number.isFinite(Date.parse(article.published_at))
        ? new Date(article.published_at).toUTCString() : "";
      return `    <item>
      <title>${xml(article.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      ${pubDate ? `<pubDate>${xml(pubDate)}</pubDate>` : ""}
      <description>${xml(description)}</description>
      <category>${xml(article.genre || "Underground")}</category>
      <enclosure url="${xml(image)}" length="0" type="image/jpeg" />
    </item>`;
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>UNDERGROUND — Independent Extreme Music Magazine</title>
    <link>${SITE}/</link>
    <description>News, reviews, charts and basement radio for the heavier corners of music.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>
`;
    return response(body);
  } catch (error) {
    const message = String(error?.message || error || "Unknown Supabase error").replace(/[<>\\r\\n]/g, " ").slice(0, 300);
    console.error("[rss.xml] " + message);
    return response(`<?xml version="1.0" encoding="UTF-8"?><error status="502">${xml(message)}</error>`, 502);
  }
}

async function latestArticles(env) {
  const svc = serviceRest(env);
  if (svc.error) throw new Error(svc.error);
  const query = new URLSearchParams({
    select: "id,slug,title,excerpt,content,genre,published_at,cover_image_url,youtube_video_id",
    status: "eq.published",
    order: "published_at.desc",
    limit: "50"
  });
  const result = await svc.rest("articles?" + query.toString());
  if (!result.ok) throw new Error(`Supabase HTTP ${result.status} ${result.statusText}: ${(await result.text()).slice(0, 240)}`);
  const rows = await result.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected articles response");
  return rows;
}
