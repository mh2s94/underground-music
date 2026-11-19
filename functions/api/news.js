// GET /api/news — "Scene Radar"
// Collects the latest headlines from heavy-music sites' public RSS/Atom feeds,
// tags them with UNDERGROUND's genres and returns a de-duplicated list.
// Only headline, short summary, source name, date and the original link are
// returned: the full articles stay on the original sites.
// Results are cached at the edge for 15 minutes.

const SOURCES = [
  { name: "Metal Injection", url: "https://metalinjection.net/feed" },
  { name: "MetalSucks", url: "https://www.metalsucks.net/feed/" },
  { name: "Theprp", url: "https://www.theprp.com/feed/" },
  { name: "Decibel", url: "https://www.decibelmagazine.com/feed/" },
  { name: "Loudwire", url: "https://loudwire.com/category/metal/feed/" },
  { name: "New Noise", url: "https://newnoisemagazine.com/feed/" },
  { name: "Distorted Sound", url: "https://distortedsoundmag.com/feed/" }
];

const GENRE_WORDS = {
  "Metalcore": ["metalcore", "metal-core"],
  "Deathcore": ["deathcore", "death-core"],
  "Hardcore": ["hardcore", "beatdown", "straight edge", "hxc"],
  "Darkcore": ["darkcore", "dark hardcore", "blackened hardcore"],
  "Post-Hardcore": ["post-hardcore", "post hardcore", "emo", "screamo"],
  "Black Metal": ["black metal", "blackgaze", "blackened"],
  "Djent": ["djent", "progressive metal", "prog metal", "progressive metalcore"]
};

const CACHE_SECONDS = 900;
const MAX_AGE_DAYS = 30;
const UA = "UndergroundMagazineBot/1.0 (+https://music.mikasa.me; scene radar)";

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const fresh = url.searchParams.get("refresh") === "1";
  const cache = caches.default;
  const cacheKey = new Request(url.origin + "/api/news?v=2", { method: "GET" });

  if (!fresh) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const results = await Promise.allSettled(SOURCES.map((s) => fetchSource(s)));
  const sources = [];
  let items = [];
  results.forEach((r, i) => {
    const s = SOURCES[i];
    if (r.status === "fulfilled") { sources.push({ name: s.name, ok: true, count: r.value.length }); items.push(...r.value); }
    else sources.push({ name: s.name, ok: false, error: String(r.reason?.message || r.reason || "failed").slice(0, 120) });
  });

  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const seen = new Set();
  items = items
    .filter((it) => it.title && it.link && (!it.date || Date.parse(it.date) >= cutoff))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .filter((it) => {
      const k = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
      if (seen.has(k) || seen.has(it.link)) return false;
      seen.add(k); seen.add(it.link);
      return true;
    })
    .slice(0, 80);

  const body = JSON.stringify({ updated: new Date().toISOString(), sources, items });
  const res = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=300, s-maxage=${CACHE_SECONDS}`
    }
  });
  if (items.length) waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function fetchSource(source) {
  const r = await fetch(source.url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(8000),
    cf: { cacheTtl: 600, cacheEverything: true }
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const xml = await r.text();
  const items = parseFeed(xml, source.name);
  if (!items.length) throw new Error("No items in feed");
  return items;
}

// ---------------------------------------------------------------------------
// Feed parsing (RSS 2.0 and Atom) without a DOM
// ---------------------------------------------------------------------------
function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks.slice(0, 30)) {
    const title = clean(tag(b, "title"));
    let link = clean(tag(b, "link"));
    if (!/^https?:\/\//i.test(link)) {
      const m = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decode(m[1]) : "";
    }
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const date = clean(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const rawSummary = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content");
    const summary = trimWords(clean(rawSummary).replace(/\s*The post .+ appeared first on .+$/i, ""), 45);
    const cats = [
      ...[...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => clean(m[1])),
      ...[...b.matchAll(/<category[^>]*term=["']([^"']+)["']/gi)].map((m) => decode(m[1]))
    ].filter(Boolean).slice(0, 12);
    const image = findImage(b);
    const video = findYoutubeVideo(b);
    const iso = date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : "";
    out.push({
      title, link: link.trim(), source: sourceName, date: iso, summary,
      image, videoUrl: video?.url || "", youtubeVideoId: video?.id || "", categories: cats,
      genres: detectGenres(title + " " + summary + " " + cats.join(" ")),
      band: guessBand(title)
    });
  }
  return out;
}

function tag(block, name) {
  const re = new RegExp(`<${name.replace(":", "\\:")}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name.replace(":", "\\:")}>`, "i");
  const m = block.match(re);
  return m ? m[1] : "";
}
function clean(s) {
  return decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function decode(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos|hellip|ndash|mdash|lsquo|rsquo|ldquo|rdquo);/g, (_, n) => ({
      nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", ndash: "–", mdash: "—",
      lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”"
    }[n]));
}
const safeChar = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "");
function trimWords(s, n) {
  const w = s.split(" ");
  return w.length > n ? w.slice(0, n).join(" ") + "…" : s;
}
function findImage(b) {
  const m = b.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i)
    || b.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i)
    || decode(b).match(/<img[^>]*src=["'](https:\/\/[^"']+)["']/i);
  const u = m ? decode(m[1]) : "";
  return /^https:\/\//i.test(u) ? u : "";
}


// Only inspect the RSS item XML; never fetch the linked article page for a video.
function findYoutubeVideo(block) {
  const decoded = decode(String(block || ""));
  const candidates = decoded.match(/(?:https?:)?\/\/(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s"'<>]+/gi) || [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.startsWith("//") ? "https:" + candidate : candidate);
      const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
      if (!["youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) continue;
      let id = "";
      if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else {
        const match = url.pathname.match(/^\/(?:embed|v|shorts|live)\/([\w-]{11})(?:$|\/)/);
        id = match?.[1] || "";
      }
      if (/^[\w-]{11}$/.test(id)) return { id, url: "https://www.youtube.com/watch?v=" + id };
    } catch { /* Ignore malformed or non-video YouTube URLs. */ }
  }
  return null;
}

function detectGenres(text) {
  const t = " " + String(text).toLowerCase() + " ";
  const found = [];
  for (const [g, words] of Object.entries(GENRE_WORDS)) {
    if (words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[-]/g, "[- ]?")}([^a-z]|$)`).test(t))) found.push(g);
  }
  // "post-hardcore" also contains "hardcore": keep both only if hardcore appears on its own too
  if (found.includes("Post-Hardcore") && found.includes("Hardcore") && !/(^|[^-a-z])hardcore/.test(t.replace(/post[- ]hardcore/g, ""))) {
    found.splice(found.indexOf("Hardcore"), 1);
  }
  return found;
}

const VERBS = new Set(("announce announces announced share shares shared release releases released drop drops dropped unveil unveils unveiled " +
  "reveal reveals revealed debut debuts return returns returned cancel cancels cancelled canceled postpone postpones sign signs signed " +
  "is are was were have has had will to on at in with for of and discuss discusses talk talks add adds part parts launch launches " +
  "stream streams premiere premieres cover covers covered detail details confirm confirms tease teases teased perform performs performed " +
  "drummer vocalist guitarist singer bassist frontman members member new announce: says said share: unleash unleashes deliver delivers " +
  "issue issues book books bring brings hit hits set sets go goes get gets make makes play plays team up").split(" "));
const LEAD = /^(watch|listen|hear|stream|video|premiere|exclusive|review|interview|news|breaking|update|report)\s*[:\-–—]?\s+/i;

function guessBand(title) {
  let t = String(title).replace(LEAD, "").replace(LEAD, "").trim();
  const colon = t.match(/^([^:]{2,40}):\s/);
  if (colon && !/\s(announce|share|release)/i.test(colon[1])) return tidyBand(colon[1]);
  const words = t.split(/\s+/);
  const out = [];
  for (const w of words) {
    const bare = w.replace(/[’']s$/i, "").replace(/[,.!?;:“”"]/g, "");
    if (!bare) break;
    if (VERBS.has(bare.toLowerCase()) && out.length) break;
    out.push(bare);
    if (/[’']s$/i.test(w) || /[,:]$/.test(w) || out.length >= 5) break;
  }
  return tidyBand(out.join(" "));
}
function tidyBand(s) {
  s = s.trim();
  if (s.length > 2 && s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return s.slice(0, 60);
}
