// POST /api/track-info  (admin only)
// Body: { title, artist, album, year, genre, filename, duration }  ← whatever the file's tags gave us
// Returns a complete, cleaned set of track details plus a cover image URL:
//   { title, artist, album, year, genre, cover_url, cover_source, sources, provider }
//
// 1. Looks the song up in free public music catalogues (iTunes Search, Deezer) for
//    album, release year, genre and official artwork. No API keys needed.
// 2. Asks the configured AI (same providers as /api/generate) to clean up names from
//    the filename/tags and pick a genre from the site's list.
// Either step may fail; the endpoint always returns its best guess.

import { buildProviders, DEFAULT_ORDER } from "./generate.js";
import { PROMPT_LIST, canonicalGenre } from "./genres-data.js";
const SYSTEM = "You identify music tracks and return strict JSON only. No prose, no code fences.";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const clean = (v, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (s) => clean(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, "").replace(/feat\..*$|ft\..*$/, "").replace(/[^a-z0-9]+/g, " ").trim();

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  let input; try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const tags = {
    title: clean(input.title, 160), artist: clean(input.artist, 160), album: clean(input.album, 160),
    year: clean(input.year, 10), genre: clean(input.genre, 60), filename: clean(input.filename, 200)
  };
  if (!tags.title && !tags.filename) return json({ error: "Nothing to identify." }, 400);

  const sources = [];
  // First pass: AI cleans names (needed when only the filename is known), catalogue in parallel
  const [ai1, cat1] = await Promise.all([
    askAI(env, tags).catch(() => null),
    tags.title && tags.artist ? lookupCatalog(tags.artist, tags.title).catch(() => null) : null
  ]);

  const title = clean(tags.title || ai1?.title || tags.filename.replace(/\.[^.]+$/, ""), 160);
  const artist = clean(tags.artist || ai1?.artist, 160);
  let cat = cat1;
  if (!cat && artist && title) cat = await lookupCatalog(artist, title).catch(() => null);
  if (cat) sources.push(cat.source);

  const yearOf = (v) => { const m = String(v || "").match(/(19[0-9]{2}|20[0-9]{2})/); return m ? Number(m[1]) : null; };
  let genre = pickGenre(ai1?.genre) || null;
  // If the AI had no catalogue hint the first time and we found one, the tag/catalogue genre is a strong hint
  if (!genre) genre = pickGenre(tags.genre) || pickGenre(cat?.genre) || "Underground";

  return json({
    title: clean(cat?.title && !tags.title ? cat.title : title, 160),
    artist: clean(artist || cat?.artist, 160),
    album: clean(tags.album || cat?.album || ai1?.album, 160) || null,
    year: yearOf(tags.year) || yearOf(cat?.year) || yearOf(ai1?.year),
    genre,
    catalog_genre: cat?.genre || null,
    cover_url: cat?.cover || null,
    cover_source: cat?.cover ? cat.source : null,
    sources,
    provider: ai1?.provider || null
  });
}

// Map tag/catalogue text like "metal", "Death Metal", "(17)" onto the genre list
function pickGenre(g) {
  const s = String(g || "").trim(); if (!s || /^\(?\d+\)?$/.test(s)) return null;
  const c = canonicalGenre(s); if (c) return c;
  if (/^metal$/i.test(s)) return "Heavy Metal";
  return null;
}

// ---------------------------------------------------------------------------
// Free catalogues
// ---------------------------------------------------------------------------
async function lookupCatalog(artist, title) {
  const [it, dz] = await Promise.allSettled([itunes(artist, title), deezer(artist, title)]);
  const a = it.status === "fulfilled" ? it.value : null;
  const d = dz.status === "fulfilled" ? dz.value : null;
  if (!a && !d) return null;
  const best = a || d;
  return { ...best, cover: (a && a.cover) || (d && d.cover) || null, genre: (a && a.genre) || (d && d.genre) || null };
}
const matches = (artist, title, gotArtist, gotTitle) => {
  const A = norm(artist), T = norm(title), a = norm(gotArtist), t = norm(gotTitle);
  return !!a && !!t && (a === A || a.includes(A) || A.includes(a)) && (t === T || t.includes(T) || T.includes(t));
};
async function itunes(artist, title) {
  const u = "https://itunes.apple.com/search?media=music&entity=song&limit=10&term=" + encodeURIComponent(artist + " " + title);
  const r = await fetch(u, { signal: AbortSignal.timeout(7000), headers: { "user-agent": "UndergroundMusic/1.0" } });
  if (!r.ok) return null;
  const j = await r.json();
  const hit = (j.results || []).find((x) => matches(artist, title, x.artistName, x.trackName));
  if (!hit) return null;
  return {
    source: "iTunes", title: hit.trackName, artist: hit.artistName, album: hit.collectionName,
    year: hit.releaseDate, genre: hit.primaryGenreName,
    cover: hit.artworkUrl100 ? hit.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null
  };
}
async function deezer(artist, title) {
  const u = "https://api.deezer.com/search?limit=10&q=" + encodeURIComponent(`artist:"${artist}" track:"${title}"`);
  const r = await fetch(u, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) return null;
  const j = await r.json();
  const hit = (j.data || []).find((x) => matches(artist, title, x.artist?.name, x.title));
  if (!hit) return null;
  let year = null;
  try {
    const al = await (await fetch("https://api.deezer.com/album/" + hit.album.id, { signal: AbortSignal.timeout(5000) })).json();
    year = al.release_date || null;
  } catch {}
  return {
    source: "Deezer", title: hit.title, artist: hit.artist?.name, album: hit.album?.title,
    year, genre: null, cover: hit.album?.cover_xl || hit.album?.cover_big || null
  };
}

// ---------------------------------------------------------------------------
// AI: clean names, choose genre
// ---------------------------------------------------------------------------
async function askAI(env, tags) {
  const prompt = `Identify this music track from its file name and embedded tags, and fill in the details.
File name: ${tags.filename || "(unknown)"}
Tag title: ${tags.title || "(none)"}
Tag artist: ${tags.artist || "(none)"}
Tag album: ${tags.album || "(none)"}
Tag year: ${tags.year || "(none)"}
Tag genre: ${tags.genre || "(none)"}

Rules:
- "title" and "artist": proper capitalisation; remove junk such as "(Official Video)", "[HQ]", "320kbps", track numbers, site names.
- "genre": exactly one name copied from the genre list below, the most specific one that fits this artist's sound; use "Underground" only if unsure.
Genre list ("Group:" words are not genres):
${PROMPT_LIST}
- "album" and "year": only if you are confident, otherwise null.
Return only JSON: {"title":"","artist":"","album":null,"year":null,"genre":""}`;

  const providers = buildProviders(env, prompt, SYSTEM, { temperature: 0.2, maxTokens: 300 });
  const order = (env.AI_PROVIDER_ORDER || DEFAULT_ORDER).split(",").map((x) => x.trim().toLowerCase())
    .filter((x) => providers[x]?.enabled);
  for (const name of order.slice(0, 3)) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const raw = await providers[name].run(ctrl.signal);
      const m = String(raw).match(/\{[\s\S]*\}/);
      if (!m) continue;
      const j = JSON.parse(m[0]);
      if (j && (j.title || j.artist)) return { ...j, provider: name };
    } catch { /* try next */ } finally { clearTimeout(t); }
  }
  return null;
}

async function requireAdmin(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Server is not configured." }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: auth };
  try {
    const u = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
    const user = await u.json();
    const a = await fetch(env.SUPABASE_URL + "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(user.id), { headers, signal: AbortSignal.timeout(8000) });
    if (!a.ok || !(await a.json()).length) return json({ error: "Administrator access required." }, 403);
    return null;
  } catch {
    return json({ error: "Could not verify your session. Try again." }, 502);
  }
}
