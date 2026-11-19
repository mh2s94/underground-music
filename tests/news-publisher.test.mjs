import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findYoutubeVideo } from "../functions/api/news.js";
import { supabaseProjectUrl, sbUrl } from "../functions/api/draft-lib.js";
import { tidySummary } from "../functions/api/news-publish.js";
import { supabaseConfig } from "../functions/api/theme/edge.js";


const source = await readFile(new URL("../functions/api/news-publish.js", import.meta.url), "utf8");
const feed = await readFile(new URL("../functions/api/news.js", import.meta.url), "utf8");

test("publisher is a POST-only, token-protected endpoint", () => {
  assert.match(source, /export async function onRequestPost/);
  assert.match(source, /NEWS_PUBLISH_TOKEN/);
  assert.match(source, /return json\(\{ error: "Not allowed\." \}, 401\)/);
});

test("publisher applies conservative editorial and volume gates", () => {
  assert.match(source, /const RUN_LIMIT = 3/);
  assert.match(source, /const DAILY_LIMIT = 10/);
  assert.match(source, /const MAX_AGE_MS = 48 \* 60 \* 60 \* 1000/);
  assert.match(source, /const MIN_SUMMARY_WORDS = 20/);
  assert.match(source, /function looksEnglish/);
  assert.match(source, /!isNews\(item\)/);
  assert.match(source, /!item\.genres\.length/);
});

test("RSS parser extracts validated YouTube video URLs from feed item XML", () => {
  assert.match(feed, /function findYoutubeVideo\(block\)/);
  assert.match(feed, /youtube-nocookie\.com/);
  assert.match(feed, /youtubeVideoId: video\?\.id/);
  assert.match(feed, /youtube\.com\/watch\?v=/);
  assert.match(feed, /never fetch the linked article page/);
});


test("YouTube RSS extraction supports watch, short, embed, shorts and nocookie URLs", () => {
  const cases = [
    ['<description>https://www.youtube.com/watch?v=abcdefghijk</description>', "abcdefghijk"],
    ['<content:encoded><![CDATA[<a href="https://youtu.be/abcdefghijk">Watch</a>]]></content:encoded>', "abcdefghijk"],
    ['<description><![CDATA[<iframe src="https://www.youtube.com/embed/abcdefghijk?rel=0"></iframe>]]></description>', "abcdefghijk"],
    ['<description>https://youtube.com/shorts/abcdefghijk</description>', "abcdefghijk"],
    ['<description>https://www.youtube-nocookie.com/embed/abcdefghijk</description>', "abcdefghijk"]
  ];
  for (const [xml, id] of cases) assert.equal(findYoutubeVideo(xml)?.id, id);
  assert.equal(findYoutubeVideo("<description>https://www.youtube.com/channel/UC123</description>"), null);
});

test("publisher embeds only a valid YouTube ID supplied by Scene Radar", () => {
  assert.doesNotMatch(source, /\/api\/generate|OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY/);
  assert.doesNotMatch(source, /cover_image_url:\s*item\.image/);
  assert.match(source, /item\.youtubeVideoId/);
  assert.match(source, /youtube\.com\/watch\?v=/);
  assert.match(source, /i\.ytimg\.com\/vi\//);
  assert.match(source, /Read the original report/);
});

test("tracking table is idempotent and client-inaccessible", async () => {
  const sql = await readFile(new URL("../supabase/news-ingestion.sql", import.meta.url), "utf8");
  assert.match(sql, /source_hash text primary key/);
  assert.match(sql, /source_url text not null unique/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all .* from anon, authenticated/i);
});

test("Supabase project URL normalization avoids malformed REST paths", () => {
  assert.equal(supabaseProjectUrl("https://example.supabase.co"), "https://example.supabase.co");
  assert.equal(supabaseProjectUrl("https://example.supabase.co/"), "https://example.supabase.co");
  assert.equal(supabaseProjectUrl("https://example.supabase.co/rest/v1"), "https://example.supabase.co");
  assert.equal(supabaseProjectUrl("https://example.supabase.co/rest/v1/"), "https://example.supabase.co");
  assert.equal(supabaseProjectUrl("https://example.supabase.co/project/path"), "");
  assert.equal(supabaseProjectUrl("ftp://example.supabase.co"), "");
  assert.equal(supabaseProjectUrl("https://user:pass@example.supabase.co"), "");
});


test("briefs end at the last full sentence instead of a cut-off word", () => {
  const long = "Deadlands have shared a new video for Savior. The track is taken from the band's new album which arrives early next year via a new label home. The band will also tour Europe with three other heavy bands in the spring and they promise more dates…";
  assert.equal(tidySummary(long), "Deadlands have shared a new video for Savior. The track is taken from the band's new album which arrives early next year via a new label home.");
  const short = "Band A announce a tour. The run starts in March and covers twenty cities across the country with special guests and more to be announced soon for fans…";
  assert.equal(tidySummary(short), short); // the first sentence alone would be under 20 words
  assert.equal(tidySummary("A full summary with no cut."), "A full summary with no cut.");
});

test("every server route normalizes SUPABASE_URL", async () => {
  const env = { SUPABASE_URL: "https://abc.supabase.co/rest/v1/", SUPABASE_ANON_KEY: "k" };
  assert.equal(sbUrl(env), "https://abc.supabase.co");
  assert.equal(supabaseConfig(env).url, "https://abc.supabase.co");
  assert.equal(supabaseConfig({ SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_ANON_KEY: "k" }).url, "https://abc.supabase.co");
  for (const f of ["sitemap.xml.js", "unsubscribe.js", "a/[slug].js", "api/generate.js", "api/track-info.js", "api/music/[[path]].js", "api/newsletter/send.js"]) {
    const code = await readFile(new URL("../functions/" + f, import.meta.url), "utf8");
    assert.doesNotMatch(code, /env\.SUPABASE_URL/, f + " uses env.SUPABASE_URL directly");
  }
});
