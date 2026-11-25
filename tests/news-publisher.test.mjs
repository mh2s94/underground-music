import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findYoutubeVideo } from "../functions/api/news.js";
import { supabaseProjectUrl } from "../functions/api/draft-lib.js";


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
  assert.match(source, /const MAX_AGE_MS = 72 \* 60 \* 60 \* 1000/);
  assert.match(source, /const MIN_SUMMARY_WORDS = 5/);
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

test("Scene Radar briefs are stored as drafts, not public articles", () => {
  assert.match(source, /status: "draft"/);
  assert.match(source, /published_at: null/);
  assert.ok(source.includes('status: "in.(draft,published)"'));
  assert.ok(source.includes('created_at: "gte." + dayStart'));
  assert.equal(source.includes('status: "published",\n      author_id: null'), false);
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
