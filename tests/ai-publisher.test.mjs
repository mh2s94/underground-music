import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalSourceUrl, normaliseTitle, sourceFromContent, validatePayload, wordCount
} from "../functions/api/ai-publish.js";

const endpoint = await readFile(new URL("../functions/api/ai-publish.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/20261120103205_create_ai_ingestion.sql", import.meta.url), "utf8");

function payload(words = 355) {
  return {
    BAND: "Example Band",
    RELEASE: "Example Release",
    TITLE: "Example Band announces new release",
    EXCERPT: "A concise summary of the release.",
    TAGS: ["metalcore", "new release"],
    GENRE: "Metalcore",
    TYPE: "News",
    SCORE: null,
    CONTENT: Array(words).fill("metalcore").join(" ") + "\n\nSource: [Official Site](https://example.com/news)"
  };
}

test("AI publisher is POST-only and requires the dedicated bearer token", () => {
  assert.match(endpoint, /export async function onRequestPost/);
  assert.match(endpoint, /AI_PUBLISH_TOKEN/);
  assert.match(endpoint, /Bearer\\s/);
  assert.match(endpoint, /return json\\(\\{ error: "Not allowed\\." \\}, 401\\)/);
});

test("publisher checks all three duplicate stores and the latest 300 articles", () => {
  assert.match(endpoint, /query\\("articles".*ARTICLE_LIMIT/s);
  assert.match(endpoint, /query\\("news_ingestion"/);
  assert.match(endpoint, /query\\("ai_ingestion"/);
  assert.match(endpoint, /normaliseTitle\\(item\\.title\\)/);
  assert.match(endpoint, /contentHasSource\\(item\\.content, sourceUrl\\)/);
});

test("content must be 350–500 words and end with an HTTPS Source Markdown line", () => {
  assert.equal(wordCount(payload().CONTENT), 362);
  assert.equal(validatePayload(payload(343)).error, undefined);
  assert.match(validatePayload(payload(342)).error, /350–500/);
  assert.match(validatePayload(payload(494)).error, /350–500/);
  assert.match(validatePayload({ ...payload(), CONTENT: payload().CONTENT + "\nEditorial note" }).error, /Source/);
  assert.equal(sourceFromContent(payload().CONTENT).url, "https://example.com/news");
});

test("canonical source URL removes tracking parameters and rejects unsafe URLs", () => {
  assert.equal(canonicalSourceUrl("https://example.com/news?utm_source=x&id=4#top"), "https://example.com/news?id=4");
  assert.equal(canonicalSourceUrl("http://example.com/news"), "");
  assert.equal(canonicalSourceUrl("https://user:pass@example.com/news"), "");
});

test("titles are normalized consistently for duplicate detection", () => {
  assert.equal(normaliseTitle("  EXAMPLE—Band: announces! "), "example band announces");
  assert.equal(normaliseTitle("Example Band announces"), normaliseTitle("EXAMPLE BAND ANNOUNCES"));
});

test("mode defaults to draft and only draft, review, published are accepted", () => {
  assert.match(endpoint, /env\\.AI_PUBLISH_MODE \\|\\| "draft"/);
  assert.match(endpoint, /\["draft", "review", "published"\]/);
});

test("ingestion migration is RLS-enabled and denies client roles while granting service_role", () => {
  assert.match(migration, /create table if not exists public\\.ai_ingestion/i);
  assert.ok(migration.toLowerCase().includes("enable row level security"));
  assert.match(migration, /revoke all on table public\\.ai_ingestion from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\\.ai_ingestion to service_role/i);
  assert.ok(migration.includes("ai_ingestion_source_url_uidx"));
  assert.ok(migration.includes("ai_ingestion_title_key_uidx"));
});
