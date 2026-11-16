// GET /api/charts                    → global metal chart (default)
// GET /api/charts?group=Deathcore     → chart for a genre group from the shared list
// GET /api/charts?genre=Slam%20Deathcore → chart for one sub-genre
// All from Deezer's free public API (no key).
//   { updated, source, bands: [...10], hits: [...10] }
// Built from Deezer's "Metal" genre artists: bands ranked by fans, hits by current
// track popularity. Every entry is a metal act. Cached 6 h (42 subrequests per build,
// under the 50 allowed on the Workers free plan).

import { GROUPS, ALL } from "./genres-data.js";

const TTL = 6 * 3600;
const DZ = "https://api.deezer.com";
const realPic = (u) => (u && !/\/artist\/\//.test(u) ? u : null); // Deezer's blank artist placeholder has an empty hash
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
  const groupName = url.searchParams.get("group"), genreName = url.searchParams.get("genre");
  let q = null, label = null;
  if (genreName) {
    label = ALL.find((g) => g.toLowerCase() === genreName.trim().toLowerCase());
    if (!label || label === "Underground") return json({ error: "Unknown genre." }, 400);
    q = label;
  } else if (groupName) {
    const g = GROUPS.find((x) => x.name.toLowerCase() === groupName.trim().toLowerCase());
    if (!g) return json({ error: "Unknown genre group." }, 400);
    q = g.q; label = g.name;
  }
  const key = new Request(url.origin + "/api/charts?v=3&q=" + encodeURIComponent((q || "").toLowerCase()));
  if (!fresh) { const hit = await cache.match(key); if (hit) return hit; }
  try {
    const data = q ? await buildGenre(q, label) : await build();
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
    picture: realPic(a.picture_xl) || realPic(a.picture_big) || tracks[0]?.album?.cover_xl || null,
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

// ---------------------------------------------------------------------------
// One genre: Deezer has no chart per sub-genre, so we use the most relevant
// playlist named after it (editorial "Deezer …" playlists first) and rank its songs.
// ~13 subrequests per build.
// ---------------------------------------------------------------------------
const nrm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9&]+/g, " ").trim();

async function buildGenre(q, label) {
  const want = nrm(q);
  const found = await get(`/search/playlist?limit=25&q=${encodeURIComponent(q)}`);
  const cands = (found.data || []).filter((p) => (" " + nrm(p.title) + " ").includes(" " + want + " ") && (p.nb_tracks || 0) >= 10);
  if (!cands.length) return { updated: new Date().toISOString(), source: "Deezer", genre: label, bands: [], hits: [], empty: true };
  const score = (p) => (/deezer/i.test(p.user?.name || "") ? 1000 : 0) + (nrm(p.title) === want ? 200 : 0)
    + (/best|essentials|top|hits|100%|classics/i.test(p.title) ? 80 : 0) - Math.abs((p.nb_tracks || 0) - 80) / 4 - (cands.indexOf(p) * 3);
  const pl = cands.sort((x, y) => score(y) - score(x))[0];

  const tr = await get(`/playlist/${pl.id}/tracks?limit=100`);
  const tracks = (tr.data || []).filter((t) => t && t.readable !== false && t.artist?.id);
  if (!tracks.length) return { updated: new Date().toISOString(), source: "Deezer", genre: label, bands: [], hits: [], empty: true };

  // Hits: most popular songs in the playlist, max 2 per artist
  const per = new Map(), seen = new Set(), hitsRaw = [];
  tracks.slice().sort((x, y) => (y.rank || 0) - (x.rank || 0)).forEach((t) => {
    const k = t.artist.id + "|" + nrm(t.title_short || t.title); const n = per.get(t.artist.id) || 0;
    if (seen.has(k) || n >= 2 || hitsRaw.length >= 10) return;
    seen.add(k); per.set(t.artist.id, n + 1); hitsRaw.push(t);
  });
  const maxHit = hitsRaw[0]?.rank || 1;
  const hits = hitsRaw.map((t, i) => ({
    rank: i + 1, title: t.title_short || t.title, artist: t.artist.name, album: t.album?.title || null,
    cover: t.album?.cover_xl || t.album?.cover_big || null,
    popularity: Math.max(1, Math.round(((t.rank || 0) / maxHit) * 100)), duration: t.duration || null,
    preview: /^https:\/\//.test(t.preview || "") ? t.preview : null, link: t.link || null
  }));

  // Bands: artists in the playlist with the most popular songs, then ranked by fans
  const agg = new Map();
  tracks.forEach((t) => { const a = agg.get(t.artist.id) || { id: t.artist.id, name: t.artist.name, sum: 0, best: null }; a.sum += t.rank || 0; if (!a.best || (t.rank || 0) > (a.best.rank || 0)) a.best = t; agg.set(t.artist.id, a); });
  const pool = [...agg.values()].sort((x, y) => y.sum - x.sum).slice(0, 10);
  const info = await Promise.all(pool.map((a) => get(`/artist/${a.id}`).catch(() => ({}))));
  const maxSum = pool[0]?.sum || 1;
  const bands = pool.map((a, i) => ({ a, inf: info[i] }))
    .sort((x, y) => ((y.inf.nb_fan || 0) - (x.inf.nb_fan || 0)) || (y.a.sum - x.a.sum))
    .map(({ a, inf }, i) => ({
      rank: i + 1, name: a.name,
      picture: realPic(inf.picture_xl) || realPic(inf.picture_big) || a.best?.album?.cover_xl || null,
      fans: inf.nb_fan || null,
      popularity: Math.max(1, Math.round((a.sum / maxSum) * 100)),
      top_track: a.best?.title_short || a.best?.title || null,
      link: inf.link || `https://www.deezer.com/artist/${a.id}`
    }));

  return { updated: new Date().toISOString(), source: "Deezer", genre: label, playlist: { title: pl.title, link: pl.link || null }, bands, hits };
}
