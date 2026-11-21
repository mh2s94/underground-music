import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestGet as sitemap } from "../functions/sitemap.xml.js";
import { onRequestGet as rss } from "../functions/rss.xml.js";

const env = { SUPABASE_URL: "https://project.example", SUPABASE_ANON_KEY: "test-key" };
const articles = [
  {
    id: 1, slug: "latest-track", title: "Latest Track & News", excerpt: "A <fresh> release",
    content: "Body text", genre: "Metalcore", published_at: "2026-11-20T10:00:00Z",
    cover_image_url: "https://cdn.example/cover.png", youtube_video_id: null
  },
  {
    id: 2, slug: "video-feature", title: "Video Feature", excerpt: "",
    content: "Fallback body text", genre: "Hardcore", published_at: "2026-11-19T10:00:00Z",
    cover_image_url: null, youtube_video_id: "yE16u9uyW28"
  }
];

async function withFetch(run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify(articles), { status: 200, headers: { "content-type": "application/json" } });
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test("sitemap is XML, cached for 15 minutes, and lists static routes plus published articles", async () => {
  await withFetch(async (calls) => {
    const response = await sitemap({ env });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/xml/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=900, s-maxage=900");
    for (const path of ["/", "/articles", "/music", "/charts", "/search", "/a/latest-track", "/a/video-feature"]) {
      assert.ok(body.includes("https://music.mikasa.me" + path));
    }
    assert.ok(body.includes("<lastmod>2026-11-20T10:00:00.000Z</lastmod>"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, undefined);
    assert.equal(calls[0].url.searchParams.get("select"), "slug,published_at");
    assert.equal(calls[0].url.searchParams.get("status"), "eq.published");
    assert.equal(calls[0].url.searchParams.get("order"), "published_at.desc");
    assert.equal(calls[0].url.searchParams.get("limit"), "1000");
  });
});

test("RSS is valid RSS 2.0 with article metadata and cover/YouTube enclosures", async () => {
  await withFetch(async (calls) => {
    const response = await rss({ env });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/rss+xml; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "public, max-age=900, s-maxage=900");
    assert.match(body, /<rss version="2\.0">/);
    assert.match(body, /<title>Latest Track &amp; News<\/title>/);
    assert.match(body, /<description>A &lt;fresh&gt; release<\/description>/);
    assert.match(body, /<category>Metalcore<\/category>/);
    assert.match(body, /url="https:\/\/cdn\.example\/cover\.png"/);
    assert.match(body, /url="https:\/\/i\.ytimg\.com\/vi\/yE16u9uyW28\/hqdefault\.jpg"/);
    assert.match(body, /<pubDate>Fri, 20 Nov 2026 10:00:00 GMT<\/pubDate>/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.searchParams.get("status"), "eq.published");
    assert.equal(calls[0].url.searchParams.get("order"), "published_at.desc");
    assert.equal(calls[0].url.searchParams.get("limit"), "50");
  });
});

test("article route emits crawler-readable OG/Twitter tags from published article data", async () => {
  const source = await readFile(new URL("../functions/a/[slug].js", import.meta.url), "utf8");
  for (const marker of [
    'meta property="og:title"', 'meta property="og:description"', 'meta property="og:url"',
    'meta property="og:type" content="article"', 'meta property="og:image"',
    'meta name="twitter:card" content="summary_large_image"', 'meta name="twitter:title"',
    'meta name="twitter:description"', 'meta name="twitter:image"', 'new HTMLRewriter()',
    'status=eq.published', 'validHttpUrl(article.cover_image_url)'
  ]) assert.ok(source.includes(marker), marker);
  assert.match(source, /youtube_video_id/);
  assert.match(source, /DEFAULT_IMAGE/);
});
