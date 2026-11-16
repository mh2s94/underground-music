// GET /api/cover?a=<artist>[&t=<song title>]  → { url, source }
// Finds real artwork for chart rows that have no cover yet:
//   with t: the song's album cover (iTunes, then Deezer)
//   without t: the artist's photo (Deezer)
// Free public APIs, no keys. Answers are cached at the edge for 7 days (misses for 1 day).

const json = (data, maxAge) => new Response(JSON.stringify(data), {
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${Math.min(maxAge, 86400)}, s-maxage=${maxAge}` }
});
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const same = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
const getJ = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const a = String(url.searchParams.get("a") || "").trim().slice(0, 120);
  const t = String(url.searchParams.get("t") || "").trim().slice(0, 160);
  if (!a) return json({ url: null, error: "Missing artist" }, 60);

  const key = new Request(`${url.origin}/api/cover?v=1&a=${encodeURIComponent(norm(a))}&t=${encodeURIComponent(norm(t))}`);
  const cache = caches.default;
  const hit = await cache.match(key); if (hit) return hit;

  let found = null;
  try {
    if (t) {
      const it = await getJ("https://itunes.apple.com/search?media=music&entity=song&limit=10&term=" + encodeURIComponent(a + " " + t)).catch(() => null);
      const m = (it?.results || []).find((x) => same(x.artistName, a) && same(x.trackName, t)) || (it?.results || []).find((x) => same(x.artistName, a));
      if (m?.artworkUrl100) found = { url: m.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb."), source: "iTunes" };
      if (!found) {
        const dz = await getJ("https://api.deezer.com/search?limit=10&q=" + encodeURIComponent(`artist:"${a}" track:"${t}"`)).catch(() => null);
        const d = (dz?.data || []).find((x) => same(x.artist?.name, a));
        if (d?.album?.cover_xl) found = { url: d.album.cover_xl, source: "Deezer" };
      }
    }
    if (!found) {
      const ar = await getJ("https://api.deezer.com/search/artist?limit=5&q=" + encodeURIComponent(a)).catch(() => null);
      const m = (ar?.data || []).find((x) => same(x.name, a));
      const pic = m?.picture_xl || m?.picture_big;
      if (pic && !/\/artist\/\/|\/images\/artist\/\//.test(pic)) found = { url: pic, source: "Deezer" }; // skip Deezer's blank placeholder
    }
  } catch {}

  const res = json(found || { url: null }, found ? 7 * 86400 : 86400);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
