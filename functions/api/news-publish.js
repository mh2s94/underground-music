// POST /api/news-publish — publish short, attributed briefs from Scene Radar RSS.
// No AI, no translation, no full-article scraping. Protected by NEWS_PUBLISH_TOKEN.

import { isNews, same, serviceRest } from "./draft-lib.js";
import { tg, esc, SITE } from "./telegram/lib.js";

const RUN_LIMIT = 3;
const DAILY_LIMIT = 10;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MIN_SUMMARY_WORDS = 20;
const CATEGORY_SLUGS = new Set(["metalcore", "deathcore", "hardcore", "darkcore"]);

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.NEWS_PUBLISH_TOKEN || !supplied || !same(supplied, String(env.NEWS_PUBLISH_TOKEN))) {
    return json({ error: "Not allowed." }, 401);
  }

  const svc = serviceRest(env);
  if (svc.error) return json({ error: svc.error }, 503);
  const { rest } = svc;

  const feedResponse = await fetch(new URL("/api/news?refresh=1", request.url), {
    headers: { "accept": "application/json" }
  });
  if (!feedResponse.ok) return json({ error: "Scene Radar could not be refreshed.", upstream_status: feedResponse.status }, 502);
  let feed;
  try { feed = await feedResponse.json(); } catch { return json({ error: "Scene Radar returned invalid JSON." }, 502); }
  const items = Array.isArray(feed.items) ? feed.items : [];
  if (!items.length) return json({ published: 0, skipped: 0, note: "No RSS items available." });

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const dailyParams = new URLSearchParams({
    select: "source_hash",
    status: "eq.published",
    published_at: "gte." + dayStart,
    limit: String(DAILY_LIMIT + 1)
  });
  const dailyRes = await rest("news_ingestion?" + dailyParams.toString());
  if (!dailyRes.ok) return json({ error: "news_ingestion table is unavailable. Apply supabase/news-ingestion.sql first.", detail: (await dailyRes.text()).slice(0, 240) }, 503);
  const dailyRows = await dailyRes.json();
  let dailyCount = dailyRows.length;
  if (dailyCount >= DAILY_LIMIT) return json({ published: 0, skipped: 0, daily_limit: DAILY_LIMIT, note: "Daily publication limit reached." });

  const categoriesRes = await rest("categories?select=id,slug&slug=in.(metalcore,deathcore,hardcore,darkcore)");
  if (!categoriesRes.ok) return json({ error: "Could not read article categories.", detail: (await categoriesRes.text()).slice(0, 200) }, 502);
  const categoryRows = await categoriesRes.json();
  const categoryBySlug = new Map(categoryRows.map((row) => [String(row.slug || "").toLowerCase(), row.id]));

  const candidates = items
    .filter((item) => qualityGate(item, now.getTime()))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  let published = 0;
  let skipped = items.length - candidates.length;
  const outcomes = [];
  for (const item of candidates) {
    if (published >= RUN_LIMIT || dailyCount >= DAILY_LIMIT) break;
    const sourceUrl = canonicalUrl(item.link);
    if (!sourceUrl) { skipped++; continue; }
    const sourceHash = await sha256(sourceUrl);
    const claim = await claimItem(rest, {
      source_hash: sourceHash,
      source_url: sourceUrl,
      title: String(item.title).slice(0, 500),
      source: String(item.source).slice(0, 120),
      source_published_at: new Date(item.date).toISOString()
    });
    if (!claim.claimed) { skipped++; continue; }

    const genres = [...new Set(item.genres.map((g) => String(g).trim()).filter(Boolean))].slice(0, 8);
    const primarySlug = genres.map((g) => g.toLowerCase().replace(/[^a-z0-9]+/g, "-")).find((g) => CATEGORY_SLUGS.has(g));
    const categoryId = primarySlug ? categoryBySlug.get(primarySlug) || null : null;
    const suffix = sourceHash.slice(0, 10);
    const slug = slugify(item.title).slice(0, 78).replace(/-+$/g, "") + "-" + suffix;
    const sourceDate = new Date(item.date).toISOString();
    const summary = String(item.summary).trim();
    const content = [
      summary,
      "",
      "Originally published by " + String(item.source).trim() + " on " + sourceDate.slice(0, 10) + ".",
      "",
      "Read the original report: [" + String(item.source).trim() + "](" + sourceUrl + ")."
    ].join("\n");

    const article = {
      title: String(item.title).trim().slice(0, 180),
      slug,
      excerpt: summary.slice(0, 500),
      content,
      kind: "News",
      status: "published",
      author_id: null,
      published_at: now.toISOString(),
      category_id: categoryId,
      genre: genres.join(", ").slice(0, 120) || null,
      tags: genres,
      cover_image_url: null
    };
    const insert = await rest("articles", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(article)
    });
    if (!insert.ok) {
      const detail = (await insert.text()).slice(0, 300);
      await markFailed(rest, sourceHash, detail);
      outcomes.push({ title: article.title, status: "failed", reason: detail });
      continue;
    }
    const inserted = await insert.json();
    const articleId = inserted?.[0]?.id || null;
    const done = await rest("news_ingestion?source_hash=eq." + sourceHash, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "published", article_id: articleId, published_at: now.toISOString(), updated_at: now.toISOString(), last_error: null })
    });
    if (!done.ok) {
      // The article exists; leave an explicit operational signal rather than trying to insert it again.
      outcomes.push({ title: article.title, status: "published_tracking_update_failed" });
    } else {
      outcomes.push({ title: article.title, status: "published", article_id: articleId });
    }
    published++;
    dailyCount++;

    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const message = "<b>UNDERGROUND · News published</b>\n" +
        esc(article.title) + "\n" +
        "<a href=\"" + SITE + "/a/" + encodeURIComponent(slug) + "\">Open article</a> · " +
        "<a href=\"" + esc(sourceUrl) + "\">Original source</a>";
      const sent = await tg(env, "sendMessage", {
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true }
      });
      if (sent.ok) {
        await rest("news_ingestion?source_hash=eq." + sourceHash, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ telegram_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
      } else {
        outcomes[outcomes.length - 1].telegram_error = String(sent.description || "Telegram notification failed").slice(0, 160);
      }
    }
  }

  return json({
    published,
    skipped,
    failed: outcomes.filter((x) => x.status === "failed").length,
    run_limit: RUN_LIMIT,
    daily_limit: DAILY_LIMIT,
    daily_total: dailyCount,
    outcomes
  });
}

function qualityGate(item, now) {
  if (!item || typeof item.title !== "string" || item.title.trim().length < 12 || item.title.trim().length > 180) return false;
  if (!item.source || typeof item.source !== "string") return false;
  if (!canonicalUrl(item.link)) return false;
  const date = Date.parse(item.date || "");
  if (!Number.isFinite(date) || date > now + 5 * 60 * 1000 || now - date > MAX_AGE_MS) return false;
  if (typeof item.summary !== "string" || wordCount(item.summary) < MIN_SUMMARY_WORDS) return false;
  if (!looksEnglish(item.title + " " + item.summary)) return false;
  if (!Array.isArray(item.genres) || !item.genres.length) return false;
  if (!isNews(item)) return false;
  return true;
}

function wordCount(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).length; }

function looksEnglish(value) {
  const words = String(value || "").toLowerCase().match(/[a-z]+/g) || [];
  const common = new Set(["the", "and", "for", "with", "from", "that", "this", "their", "they", "was", "were", "are", "is", "has", "have", "will", "after", "before", "into", "about", "over", "under", "its", "new", "who", "which", "when", "where", "by", "on", "in", "to", "of", "as", "at"]);
  return words.length >= 20 && words.filter((word) => common.has(word)).length >= 2;
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return ""; }
}

function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene-news";
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function claimItem(rest, item) {
  const insert = await rest("news_ingestion?on_conflict=source_hash", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ ...item, status: "processing", attempts: 1 })
  });
  if (!insert.ok) return { claimed: false };
  const inserted = await insert.json();
  if (inserted.length) return { claimed: true };

  const existingRes = await rest("news_ingestion?source_hash=eq." + item.source_hash + "&select=status,updated_at,attempts");
  if (!existingRes.ok) return { claimed: false };
  const [existing] = await existingRes.json();
  if (!existing || !["failed", "processing"].includes(existing.status)) return { claimed: false };
  const stale = !existing.updated_at || Date.now() - Date.parse(existing.updated_at) > 20 * 60 * 1000;
  if (!stale) return { claimed: false };
  const retry = await rest("news_ingestion?source_hash=eq." + item.source_hash + "&status=in.(failed,processing)", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "processing", attempts: Number(existing.attempts || 1) + 1, last_error: null, updated_at: new Date().toISOString() })
  });
  if (!retry.ok) return { claimed: false };
  return { claimed: (await retry.json()).length > 0 };
}

async function markFailed(rest, hash, reason) {
  await rest("news_ingestion?source_hash=eq." + hash, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", last_error: String(reason).slice(0, 1000), updated_at: new Date().toISOString() })
  });
}
