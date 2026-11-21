import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalSourceUrl, normaliseTitle, sourceFromContent, validatePayload, wordCount, youtubeIdFromUrl,
  parseDailyLimit, slugify, nextAvailableSlug, fallbackSourceUrl
} from "../functions/api/ai-publish.js";

const endpoint = await readFile(new URL("../functions/api/ai-publish.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/20261120103205_create_ai_ingestion.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("../supabase/20261121120000_ai_publish_hardening.sql", import.meta.url), "utf8");
const mediaMigration = await readFile(new URL("../supabase/20261121170000_ai_publish_media_fields.sql", import.meta.url), "utf8");
const bento = await readFile(new URL("../assets/bento.js", import.meta.url), "utf8");

function payload(words = 355, genre = "Metalcore") {
  return {
    BAND: "Example Band", RELEASE: "Example Release",
    TITLE: "Example Band announces new release",
    EXCERPT: "A concise summary of the release.",
    TAGS: ["metalcore", "new release"], GENRE: genre,
    TYPE: "News", SCORE: null,
    CONTENT: Array(words).fill("metalcore").join(" ") + "\n\nSource: [Official Site](https://example.com/news)"
  };
}

test("AI publisher is POST-only and requires the dedicated bearer token", () => {
  assert.ok(endpoint.includes("export async function onRequestPost"));
  assert.ok(endpoint.includes("AI_PUBLISH_TOKEN"));
  assert.ok(endpoint.includes("Bearer"));
  assert.ok(endpoint.includes('return json({ error: "Not allowed." }, 401)'));
});

test("publisher checks published article and completed ingestion records before claiming", () => {
  assert.ok(endpoint.includes('query("articles"'));
  assert.ok(endpoint.includes("ARTICLE_LIMIT = 300"));
  assert.ok(endpoint.includes('query("news_ingestion"'));
  assert.ok(endpoint.includes('query("ai_ingestion"'));
  assert.ok(endpoint.includes('status: "in.(draft,published)"'));
  assert.ok(endpoint.includes('status: "eq.processed"'));
  assert.ok(endpoint.includes("rpc/ug_claim_ai_publish"));
});

test("content must be 350–500 words and end with an HTTPS Source Markdown line", () => {
  assert.equal(wordCount(payload().CONTENT), 362);
  assert.equal(validatePayload(payload(343)).error, undefined);
  assert.match(validatePayload(payload(342)).error, /350–500/);
  assert.match(validatePayload(payload(494)).error, /350–500/);
  // Source line is optional now: trailing text after it is no longer rejected.
  assert.equal(validatePayload({ ...payload(), CONTENT: payload().CONTENT + "\nEditorial note" }).error, undefined);
  assert.equal(sourceFromContent(payload().CONTENT).url, "https://example.com/news");
  assert.equal(sourceFromContent("no source line here"), null);
});

test("canonical source URL removes tracking parameters and rejects unsafe URLs", () => {
  assert.equal(canonicalSourceUrl("https://example.com/news?utm_source=x&id=4#top"), "https://example.com/news?id=4");
  assert.equal(canonicalSourceUrl("http://example.com/news"), "");
  assert.equal(canonicalSourceUrl("https://user:pass@example.com/news"), "");
});

test("source resolution: Source line wins, SOURCE_URL fallback, invalid SOURCE_URL rejected", () => {
  // 1. Valid trailing Source line is used as-is.
  const withSource = validatePayload(payload());
  assert.equal(withSource.error, undefined);
  assert.equal(withSource.article.SOURCE_URL, "https://example.com/news");

  // 2. No Source line + valid SOURCE_URL -> canonical fallback (tracking params dropped).
  const noSource = { ...payload(), CONTENT: Array(355).fill("metalcore").join(" ") };
  const fallback = validatePayload({ ...noSource, SOURCE_URL: "https://example.com/original?utm_source=x&id=4#top" });
  assert.equal(fallback.error, undefined);
  assert.equal(fallback.article.SOURCE_URL, "https://example.com/original?id=4");

  // 3. Invalid SOURCE_URL -> rejected.
  assert.match(validatePayload({ ...noSource, SOURCE_URL: "http://example.com/x" }).error, /SOURCE_URL/);
  assert.match(validatePayload({ ...noSource, SOURCE_URL: "javascript:alert(1)" }).error, /SOURCE_URL/);
  assert.match(validatePayload({ ...noSource, SOURCE_URL: "not a url" }).error, /SOURCE_URL/);

  // 4. Neither present -> allowed; resolved at runtime to a unique placeholder.
  const neither = validatePayload(noSource);
  assert.equal(neither.error, undefined);
  assert.equal(neither.article.SOURCE_URL, "");
  assert.equal(fallbackSourceUrl(normaliseTitle(noSource.TITLE)), fallbackSourceUrl(normaliseTitle(noSource.TITLE)));
  assert.notEqual(fallbackSourceUrl("a b"), fallbackSourceUrl("a-c"));

  // Endpoint wiring: no null deref, placeholder only when empty, Telegram link conditional.
  assert.doesNotMatch(endpoint, /sourceFromContent\(article\.CONTENT\)\.url/);
  assert.match(endpoint, /article\.SOURCE_URL \|\| fallbackSourceUrl\(titleKey\)/);
  assert.match(endpoint, /article\.SOURCE_URL \? /);
});

test("titles are normalized consistently for duplicate detection", () => {
  assert.equal(normaliseTitle("  EXAMPLE—Band: announces! "), "example band announces");
  assert.equal(normaliseTitle("Example Band announces"), normaliseTitle("EXAMPLE BAND ANNOUNCES"));
});

test("genre is normalized through the admin generator's official genre catalogue", () => {
  assert.equal(validatePayload(payload(355, "  melodic metalcore ")).article.GENRE, "Melodic Metalcore");
  assert.equal(validatePayload(payload(355, "METALCORE")).article.GENRE, "Metalcore");
  assert.match(validatePayload(payload(355, "Metal")).error, /official site genre/);
});

test("daily quota defaults to ten and validates an explicit environment override", () => {
  assert.deepEqual(parseDailyLimit(undefined), { value: 10 });
  assert.deepEqual(parseDailyLimit("25"), { value: 25 });
  assert.match(parseDailyLimit("0").error, /integer from 1 to 1000/);
  assert.match(parseDailyLimit("10.5").error, /integer from 1 to 1000/);
  assert.ok(endpoint.includes("AI_PUBLISH_DAILY_LIMIT"));
  assert.ok(endpoint.includes("Daily AI publish limit reached."));
  assert.ok(endpoint.indexOf('claimResult?.outcome === "daily_limit"') < endpoint.indexOf('!claimResult?.ingestion_id'), "daily-limit result must be handled even when no ingestion id is returned");
  assert.match(hardening, /pg_advisory_xact_lock/);
  assert.match(hardening, /v_has_existing := found/);
  assert.match(hardening, /if v_has_existing then/);
  assert.doesNotMatch(hardening, /if found and v_existing\.id/);
  assert.match(hardening, /daily_count/);
});

test("slug generation uses clean title slugs and numeric collision suffixes only", async () => {
  assert.equal(slugify("The New Wave: A Test!"), "the-new-wave-a-test");
  assert.doesNotMatch(slugify("The New Wave"), /[a-f0-9]{10}$/);
  const taken = new Set(["the-new-wave", "the-new-wave-2"]);
  const fakeRest = async (path) => {
    const url = new URL("https://example.test/rest/v1/" + path);
    const slug = url.searchParams.get("slug").replace(/^eq\./, "");
    return new Response(JSON.stringify(taken.has(slug) ? [{ id: "existing" }] : []), { status: 200 });
  };
  assert.equal(await nextAvailableSlug(fakeRest, "The New Wave"), "the-new-wave-3");
});

test("failed ingestion claims can be retried and successful status follows article persistence", () => {
  assert.match(hardening, /v_existing\.status = 'processing'/);
  assert.match(hardening, /'retry'/);
  assert.match(hardening, /status = 'processed'/);
  assert.match(endpoint, /status: "failed"/);
  assert.ok(endpoint.indexOf('method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row)') < endpoint.indexOf('status: "processed", article_id: articleId'));
});

test("ingestion migration is RLS-enabled and denies client roles while granting service_role", () => {
  assert.ok(migration.includes("create table if not exists public.ai_ingestion"));
  assert.ok(migration.toLowerCase().includes("enable row level security"));
  assert.ok(migration.includes("revoke all on table public.ai_ingestion from public, anon, authenticated"));
  assert.ok(migration.includes("grant select, insert, update, delete on table public.ai_ingestion to service_role"));
  assert.ok(migration.includes("ai_ingestion_source_url_uidx"));
  assert.ok(migration.includes("ai_ingestion_title_key_uidx"));
});

test("atomic quota claim RPC is service-role only", () => {
  assert.match(hardening, /create or replace function public\.ug_claim_ai_publish/);
  assert.match(hardening, /grant execute on function public\.ug_claim_ai_publish[\s\S]*to service_role/);
  assert.match(hardening, /revoke all on function public\.ug_claim_ai_publish[\s\S]*from public, anon, authenticated/);
});

test("AI publisher validates and persists cover image aliases without empty overwrites", () => {
  const image = "https://cdn.example.com/cover-hd.jpg";
  for (const key of ["image", "cover_url", "cover_image"]) {
    const result = validatePayload({ ...payload(), [key]: image });
    assert.equal(result.error, undefined);
    assert.equal(result.article.COVER_IMAGE_URL, image);
  }
  assert.equal(validatePayload({ ...payload(), image: "" }).article.COVER_IMAGE_URL, "");
  assert.match(validatePayload({ ...payload(), image: "javascript:alert(1)" }).error, /http or https URL/);
  assert.match(validatePayload({ ...payload(), cover_url: "not-a-url" }).error, /http or https URL/);
  assert.match(endpoint, /cover_image_url: article\.COVER_IMAGE_URL/);
});

test("AI publisher validates YouTube ids and extracts ids from supported YouTube URLs", () => {
  const id = "yE16u9uyW28";
  assert.equal(validatePayload({ ...payload(), youtubeVideoId: id }).article.YOUTUBE_VIDEO_ID, id);
  assert.equal(validatePayload({ ...payload(), videoUrl: "https://www.youtube.com/watch?v=" + id }).article.YOUTUBE_VIDEO_ID, id);
  assert.equal(validatePayload({ ...payload(), videoUrl: "https://youtu.be/" + id }).article.YOUTUBE_VIDEO_ID, id);
  assert.equal(youtubeIdFromUrl("https://www.youtube.com/shorts/" + id), id);
  assert.equal(youtubeIdFromUrl("https://youtube.com/embed/" + id), id);
  assert.match(validatePayload({ ...payload(), youtubeVideoId: "bad-id" }).error, /11 letters/);
  assert.match(validatePayload({ ...payload(), videoUrl: "https://example.com/" + id }).error, /valid YouTube URL/);
  assert.match(validatePayload({ ...payload(), youtubeVideoId: id, videoUrl: "https://youtu.be/abcdefghijk" }).error, /does not match/);
  assert.match(endpoint, /youtube_video_id: article\.YOUTUBE_VIDEO_ID/);
  assert.match(bento, /videoIdOf/);
  assert.match(bento, /youtube_video_id/);
});

test("media migration adds a nullable constrained video id without changing existing article rows", () => {
  assert.match(mediaMigration, /add column if not exists youtube_video_id text/);
  assert.ok(mediaMigration.includes("youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'"));
});
