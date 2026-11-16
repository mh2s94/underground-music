// GET /api/band?name=Lorna%20Shore → public profile data for a band page, from Deezer's free API.
//   { name, picture, fans, albums, link, top: [{ title, album, cover, preview, duration, link }], related: [...] }
// Cached at the edge for 24 h (misses for 6 h). ~4 subrequests.

const json = (data, maxAge) => new Response(JSON.stringify(data), {
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=3600, s-maxage=${maxAge}` }
});
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const realPic = (u) => (u && !/\/artist\/\//.test(u) ? u : null);
const get = async (path) => {
  const r = await fetch("https://api.deezer.com" + path, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json(); if (j?.error) throw new Error(j.error.message || "Deezer error");
  return j;
};

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const name = String(url.searchParams.get("name") || "").replace(/[-_]+/g, " ").trim().slice(0, 120);
  if (!name) return json({ error: "Missing name" }, 60);
  const key = new Request(`${url.origin}/api/band?v=2&n=${encodeURIComponent(norm(name))}`);
  const cache = caches.default;
  const hit = await cache.match(key); if (hit) return hit;

  let out = { name, found: false };
  try {
    const s = await get(`/search/artist?limit=5&q=${encodeURIComponent(name)}`);
    const a = (s.data || []).find((x) => norm(x.name) === norm(name)) || null;
    if (a) {
      const [info, top, rel] = await Promise.all([
        get(`/artist/${a.id}`).catch(() => ({})),
        get(`/artist/${a.id}/top?limit=5`).catch(() => ({ data: [] })),
        get(`/artist/${a.id}/related?limit=6`).catch(() => ({ data: [] }))
      ]);
      out = {
        found: true, name: a.name,
        picture: realPic(info.picture_xl) || realPic(a.picture_xl) || null,
        fans: info.nb_fan || a.nb_fan || null, albums: info.nb_album || null,
        link: info.link || a.link || null,
        top: (top.data || []).filter((t) => t.readable !== false).map((t) => ({
          id: t.id, title: t.title_short || t.title, album: t.album?.title || null,
          cover: t.album?.cover_xl || t.album?.cover_big || null,
          preview: /^https:\/\//.test(t.preview || "") ? t.preview : null,
          duration: t.duration || null, link: t.link || null
        })),
        related: (rel.data || []).slice(0, 6).map((r) => ({ name: r.name, picture: realPic(r.picture_big) || realPic(r.picture_medium), fans: r.nb_fan || null }))
      };
    }
  } catch { /* answer with found:false */ }
  const res = json(out, out.found ? 86400 : 21600);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
