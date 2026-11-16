// GET /api/charts → global metal chart from Deezer's free public API (no key).
//   { updated, source, bands: [...10], hits: [...10] }
// Built from Deezer's "Metal" genre artists: bands ranked by fans, hits by current
// track popularity. Every entry is a metal act. Cached 6 h (42 subrequests per build,
// under the 50 allowed on the Workers free plan).

const TTL = 6 * 3600;
const DZ = "https://api.deezer.com";
const json = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": maxAge ? `public, max-age=600, s-maxage=${maxAge}` : "no-store" }
});
const get = async (path) => {
  const r = await fetch(DZ + path, { signal: AbortSignal.timeout(7000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("Deezer HTTP " + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error("Deezer: " + (j.error.message || "error"));
  return j;
};

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const fresh = url.searchParams.has("fresh");
  const cache = caches.default;
  const key = new Request(url.origin + "/api/charts?v=2");
  if (!fresh) { const hit = await cache.match(key); if (hit) return hit; }
  try {
    const data = await build();
    const res = json(data, 200, TTL);
    waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    const stale = await cache.match(key);
    if (stale) return stale;
    return json({ error: "Global chart is unavailable right now. Try again later.", detail: String(e.message || e) }, 502);
  }
}

async function build() {
  // Find the Metal genre id (464 on Deezer) by name, so a renumbering cannot break us.
  let genreId = 464;
  try { const g = await get("/genre"); const m = (g.data || []).find((x) => /^metal$/i.test(x.name)); if (m) genreId = m.id; } catch {}

  const ga = await get(`/genre/${genreId}/artists`);
  const artists = (ga.data || []).slice(0, 20);
  if (!artists.length) throw new Error("No metal artists returned");

  const tops = await Promise.all(artists.map((a) => get(`/artist/${a.id}/top?limit=3`).then((r) => r.data || []).catch(() => [])));

  // Band popularity = average Deezer rank of its current top tracks
  const scored = artists.map((a, i) => {
    const t = tops[i].filter((x) => x && x.readable !== false);
    const avg = t.length ? t.reduce((s, x) => s + (x.rank || 0), 0) / t.length : 0;
    return { a, tracks: t, score: avg };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);

  // Top bands = most fans (ties broken by current popularity)
  const fans = await Promise.all(scored.map(({ a }) => get(`/artist/${a.id}`).then((r) => r.nb_fan || 0).catch(() => 0)));
  scored.forEach((x, i) => { x.fans = fans[i]; });
  const maxBand = Math.max(1, ...scored.map((x) => x.score));
  const topBands = scored.slice().sort((x, y) => (y.fans - x.fans) || (y.score - x.score)).slice(0, 10);
  const bands = topBands.map(({ a, tracks, score, fans: nbFans }, i) => ({
    rank: i + 1,
    name: a.name,
    picture: a.picture_xl || a.picture_big || a.picture_medium || null,
    fans: nbFans || null,
    popularity: Math.max(1, Math.round((score / maxBand) * 100)),
    top_track: tracks[0]?.title_short || tracks[0]?.title || null,
    link: a.link || `https://www.deezer.com/artist/${a.id}`
  }));

  // Hits = the most popular tracks across those artists, max 2 per band for variety
  const seen = new Set(), perArtist = new Map(), hitsRaw = [];
  scored.flatMap((x) => x.tracks).sort((x, y) => (y.rank || 0) - (x.rank || 0)).forEach((t) => {
    const k = (t.artist?.name || "") + "|" + (t.title_short || t.title || "").toLowerCase();
    const n = perArtist.get(t.artist?.id) || 0;
    if (seen.has(k) || n >= 2 || hitsRaw.length >= 10) return;
    seen.add(k); perArtist.set(t.artist?.id, n + 1); hitsRaw.push(t);
  });
  const maxHit = hitsRaw[0]?.rank || 1;
  const hits = hitsRaw.map((t, i) => ({
    rank: i + 1,
    title: t.title_short || t.title,
    artist: t.artist?.name || "",
    album: t.album?.title || null,
    cover: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || null,
    popularity: Math.max(1, Math.round(((t.rank || 0) / maxHit) * 100)),
    duration: t.duration || null,
    preview: /^https:\/\//.test(t.preview || "") ? t.preview : null,
    link: t.link || null
  }));

  return { updated: new Date().toISOString(), source: "Deezer", genre_id: genreId, bands, hits };
}
