import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalSourceUrl, normaliseTitle, sourceFromContent, validatePayload, wordCount,
  parseDailyLimit, slugify, nextAvailableSlug
} from "../functions/api/ai-publish.js";

const endpoint = await readFile(new URL("../functions/api/ai-publish.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/20261120103205_create_ai_ingestion.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("../supabase/20261121120000_ai_publish_hardening.sql", import.meta.url), "utf8");

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
