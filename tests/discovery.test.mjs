import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("article reader adds four newest related published stories, excluding the current story", async () => {
  const source = await read("assets/bento.js");
  const start = source.indexOf("async function getRelatedStories(article)");
  const end = source.indexOf("async function openArticle(key)", start);
  assert.ok(start >= 0 && end > start, "related-story helper exists");
  const block = source.slice(start, end);
  for (const marker of [
    'db.from("articles").select(ACOLS)',
    '.eq("status", "published")',
    '.neq("id", article.id)',
    '.order("published_at", { ascending: false })',
    '.slice(0, 4)',
    'Related Stories',
    'Boolean(videoIdOf(a))'
  ]) assert.ok(block.includes(marker), marker);
  assert.ok(source.includes("relatedStoriesHtml(related)"));
});

test("search page supports title, band, genre, excerpt, tags, VIDEO and combinable genre filters", async () => {
  const source = await read("assets/bento.js");
  const start = source.indexOf("let searchIndex = null");
  const end = source.indexOf("function openSearch()", start);
  assert.ok(start >= 0 && end > start, "search page implementation exists");
  const block = source.slice(start, end);
  for (const marker of [
    'db.from("articles").select(ACOLS)',
    '.eq("status", "published")',
    'a.title,a.band_name,a.genre,a.excerpt,a.album_name,tags',
    'pageSearchVideoOnly',
    'pageSearchGenre',
    'Boolean(videoIdOf(a))',
    'data-search-filter',
    'href="/band/'
  ]) assert.ok(block.includes(marker), marker);
  assert.match(block, /\.limit\(1000\)/);
});

test("band profile is sourced only from published public.articles SELECTs", async () => {
  const source = await read("assets/bento.js");
  const start = source.indexOf("async function renderBand(slug)");
  const end = source.indexOf("// ---- Now playing (full screen)", start);
  assert.ok(start >= 0 && end > start, "band renderer exists");
  const block = source.slice(start, end);
  assert.ok(block.includes('db.from("articles").select(ACOLS)'));
  assert.ok(block.includes('.eq("status", "published")'));
  assert.ok(block.includes('Stories &amp; videos'));
  assert.ok(block.includes('Latest update'));
  assert.ok(!block.includes(".rpc("), "no RPC in band profile");
  assert.ok(!block.includes('from("tracks")'), "no tracks-table query in band profile");
  assert.ok(!block.includes("fetch("), "no external data fetch in band profile");
  const route = await read("functions/band/[slug].js");
  assert.ok(!route.includes("api.deezer.com"));
  assert.ok(!route.includes("/rest/v1/tracks"));
  assert.ok(!route.includes(".rpc("));
});

test("search and band pages support direct navigation and reload", async () => {
  const [html, source, route] = await Promise.all([
    read("index.html"), read("assets/bento.js"), read("functions/band/[slug].js")
  ]);
  assert.match(html, /id="view-search" data-view="search"/);
  assert.ok(source.includes('const searchPath = /^\\/search\\/?$/.test(location.pathname);'));
  assert.ok(source.includes('showView("search")'));
  assert.ok(source.includes('location.pathname.match(/^\\/band\\/([^/]+)\\/?$/)'));
  assert.ok(route.includes('env.ASSETS.fetch(new Request(new URL("/", request.url)))'));
});


test("search discovery filters stay in a compact horizontal strip and empty state has readable spacing", async () => {
  const [css, html, source] = await Promise.all([read("assets/bento.css"), read("index.html"), read("assets/bento.js")]);
  assert.match(css, /\.search-page-filters\{[^}]*display:flex;flex-wrap:nowrap;[^}]*overflow-x:auto/s);
  assert.match(css, /\.search-page-filters \.pill\{flex:0 0 auto/);
  assert.match(css, /\.search-page-stories\{padding:0;background:transparent;border:0/);
  assert.match(css, /\.search-no-results\{display:flex;flex-direction:column;gap:6px\}/);
  assert.match(html, /class="bento-item search-page-hero"/);
  assert.match(html, /class="search-page-stories bento-item"/);
  assert.match(source, /No stories found<\/strong><span>Try another band, genre, tag or title\.<\/span>/);
});

test("VIDEO detection falls back to a YouTube URL inside content when youtube_video_id is null", async () => {
  const source = await read("assets/bento.js");
  // Pull the real YT_LINE / ytId / videoIdOf declarations straight from the source (skip unrelated
  // lines such as the browser-only `window.supabase` client setup).
  const decl = (re) => (source.match(re) || [""])[0];
  const ytLine = decl(/const YT_LINE = .*?;\n/);
  const ytId = decl(/const ytId = .*?;\n/);
  const videoIdOfDecl = decl(/const videoIdOf = .*?;\n/);
  assert.ok(ytLine && ytId && videoIdOfDecl, "video helpers are present in bento.js");
  const { videoIdOf } = new Function(ytLine + ytId + videoIdOfDecl + "\nreturn { videoIdOf };")();

  // null column, YouTube URL on its own line inside content -> detected.
  const fixture = { youtube_video_id: null, content: "Some body copy\nhttps://www.youtube.com/watch?v=yE16u9uyW28\nmore text" };
  assert.equal(videoIdOf(fixture), "yE16u9uyW28");

  // youtu.be short form also detected.
  assert.equal(videoIdOf({ youtube_video_id: null, content: "x\nhttps://youtu.be/yE16u9uyW28\n" }), "yE16u9uyW28");

  // Valid column still wins; no video anywhere -> empty string.
  assert.equal(videoIdOf({ youtube_video_id: "abcdefghijk", content: "" }), "abcdefghijk");
  assert.equal(videoIdOf({ youtube_video_id: null, content: "no url here" }), "");

  // Static guard: the old column-only helper must be gone.
  assert.ok(!source.includes("hasVideoField(a)"));
});

