// POST /api/ai-publish — persist a structured AI-written article from the VPS publisher.
// Protected by AI_PUBLISH_TOKEN. The caller supplies the article; this endpoint does not call an AI provider.
import { same, serviceRest } from "./draft-lib.js";
import { tg, esc, SITE } from "./telegram/lib.js";
import { canonicalGenre } from "./genres-data.js";

const ARTICLE_LIMIT = 300;
const ALLOWED_TYPES = new Set(["Review", "News", "Feature", "Interview"]);
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  const supplied = match?.[1]?.trim() || "";
  if (!env.AI_PUBLISH_TOKEN || !supplied || !same(supplied, String(env.AI_PUBLISH_TOKEN))) return json({ error: "Not allowed." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const payload = body?.article && typeof body.article === "object" ? body.article : body;
  const validation = validatePayload(payload);
  if (validation.error) return json({ error: validation.error }, 400);
  const article = validation.article;
  const dailyLimit = parseDailyLimit(env.AI_PUBLISH_DAILY_LIMIT);
  const sourceUrl = canonicalSourceUrl(sourceFromContent(article.CONTENT).url);
  const titleKey = normaliseTitle(article.TITLE);
  const mode = String(env.AI_PUBLISH_MODE || "draft").trim().toLowerCase();
  if (!["draft", "review", "published"].includes(mode)) return json({ error: "AI_PUBLISH_MODE must be draft, review, or published." }, 503);
  if (dailyLimit.error) return json({ error: dailyLimit.error }, 503);

  const svc = serviceRest(env);
  if (svc.error) return json({ error: svc.error }, 503);
  const { rest } = svc;
  const duplicate = await findDuplicate(rest, article.TITLE, titleKey, sourceUrl);
  if (duplicate.error) return json({ error: "Could not complete duplicate checks.", detail: duplicate.error }, 503);
  if (duplicate.match) return json({ error: "Duplicate article rejected.", duplicate: duplicate.match }, 409);

  const claim = await rest("rpc/ug_claim_ai_publish", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      p_title: article.TITLE, p_title_key: titleKey, p_source_url: sourceUrl,
      p_band: article.BAND || null, p_release: article.RELEASE || null,
      p_genre: article.GENRE, p_article_type: article.TYPE, p_score: article.SCORE ?? null,
      p_mode: mode, p_daily_limit: dailyLimit.value
    })
  });
  if (!claim.ok) {
    const detail = (await claim.text()).slice(0, 300);
    return json({ error: "Could not reserve this AI publish attempt.", detail }, 503);
  }
  const claimResult = (await claim.json())?.[0];
  if (claimResult?.outcome === "daily_limit") return json({ error: "Daily AI publish limit reached.", limit: dailyLimit.value, published_today: claimResult.daily_count }, 429);
  if (!claimResult?.ingestion_id) return json({ error: "AI publish claim returned no id." }, 503);
  if (["duplicate", "in_progress", "already_saved"].includes(claimResult.outcome)) {
    return json({ error: claimResult.outcome === "in_progress" ? "This article is already being processed." : "Duplicate article rejected.", duplicate: claimResult.outcome }, 409);
  }
  if (!["claimed", "retry"].includes(claimResult.outcome)) return json({ error: "Unexpected AI publish claim result.", detail: claimResult.outcome || null }, 503);
  const ingestionId = claimResult.ingestion_id;

  const now = new Date();
  let slug = "";
  let inserted = null;
  let insertDetail = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      slug = await nextAvailableSlug(rest, article.TITLE);
    } catch (error) {
      insertDetail = String(error?.message || error).slice(0, 500);
      break;
    }
    const row = {
      title: article.TITLE, slug, excerpt: article.EXCERPT, content: article.CONTENT.trim(),
      band_name: article.BAND || null, album_name: article.RELEASE || null, tags: article.TAGS,
      genre: article.GENRE, kind: article.TYPE, score: article.SCORE ?? null,
      status: mode, author_id: null, published_at: mode === "published" ? now.toISOString() : null,
      ...(article.COVER_IMAGE_URL ? { cover_image_url: article.COVER_IMAGE_URL } : {}),
      ...(article.YOUTUBE_VIDEO_ID ? { youtube_video_id: article.YOUTUBE_VIDEO_ID } : {})
    };
    inserted = await rest("articles", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row)
    });
    if (inserted.ok) break;
    insertDetail = (await inserted.text()).slice(0, 500);
    if (!isSlugConflict(insertDetail)) break;
  }
  if (!inserted?.ok) {
    await updateClaim(rest, ingestionId, { status: "failed", last_error: insertDetail || "Article insert failed.", updated_at: new Date().toISOString() });
    return json({ error: "Article insert failed.", detail: insertDetail }, 502);
  }
  const articleId = (await inserted.json())?.[0]?.id || null;
  if (!articleId) {
    await updateClaim(rest, ingestionId, { status: "failed", last_error: "Article insert returned no id.", updated_at: new Date().toISOString() });
    return json({ error: "Article was inserted but no article id was returned." }, 502);
  }
  const tracked = await updateClaim(rest, ingestionId, {
    status: "processed", article_id: articleId, processed_at: now.toISOString(),
    updated_at: now.toISOString(), last_error: null
  });
  if (!tracked.ok) return json({ ok: true, article_id: articleId, status: mode, warning: "Article saved, but ai_ingestion tracking update failed." }, 201);

  let telegram = "not_configured";
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      const message = "<b>UNDERGROUND · AI article " + esc(mode) + "</b>\n" +
        esc(article.TITLE) + "\n" +
        "<a href=\""+SITE+"/a/"+encodeURIComponent(slug)+"\">Open article</a> · " +
        "<a href=\""+esc(sourceUrl)+"\">Source</a>";
      const sent = await tg(env, "sendMessage", {
        chat_id: env.TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML",
        link_preview_options: { is_disabled: true }
      });
      telegram = sent.ok ? "sent" : "failed";
    } catch { telegram = "failed"; }
  }
  return json({ ok: true, article_id: articleId, ingestion_id: ingestionId, status: mode, telegram }, 201);
}

async function findDuplicate(rest, title, titleKey, sourceUrl) {
  const query = async (table, filters, select, limit = 5) => {
    const params = new URLSearchParams({ select, ...filters, limit: String(limit) });
    const response = await rest(table + "?" + params.toString());
    if (!response.ok) return { error: table + ": " + (await response.text()).slice(0, 180) };
    return { rows: await response.json() };
  };
  const [recent, newsByUrl, newsByTitle, aiByUrl, aiByTitle] = await Promise.all([
    query("articles", { order: "created_at.desc" }, "title,content", ARTICLE_LIMIT),
    query("news_ingestion", { source_url: "eq." + sourceUrl, status: "in.(draft,published)" }, "title,source_url"),
    query("news_ingestion", { title: "ilike." + title, status: "in.(draft,published)" }, "title,source_url"),
    query("ai_ingestion", { source_url: "eq." + sourceUrl, status: "eq.processed" }, "title,source_url"),
    query("ai_ingestion", { title_key: "eq." + titleKey, status: "eq.processed" }, "title,title_key,source_url")
  ]);
  for (const result of [recent, newsByUrl, newsByTitle, aiByUrl, aiByTitle]) if (result.error) return { error: result.error };
  const articleMatch = recent.rows.find((item) =>
    normaliseTitle(item.title) === titleKey || contentHasSource(item.content, sourceUrl));
  if (articleMatch) return { match: { table: "articles", title: articleMatch.title } };
  const news = newsByUrl.rows[0] || newsByTitle.rows.find((item) => normaliseTitle(item.title) === titleKey);
  if (news) return { match: { table: "news_ingestion", title: news.title } };
  const ai = aiByUrl.rows[0] || aiByTitle.rows[0];
  return ai ? { match: { table: "ai_ingestion", title: ai.title } } : { match: null };
}

async function updateClaim(rest, id, patch) {
  return rest("ai_ingestion?id=eq." + encodeURIComponent(id), {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch)
  });
}

export function validatePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "JSON object required." };
  const textField = (key, max, required = true) => {
    const v = value[key];
    if (!required && (v == null || v === "")) return "";
    if (typeof v !== "string" || !v.trim() || v.trim().length > max) return key + " must be a non-empty string of at most " + max + " characters.";
    return v.trim();
  };
  const fields = {
    BAND: textField("BAND", 160, false), RELEASE: textField("RELEASE", 160, false),
    TITLE: textField("TITLE", 180), EXCERPT: textField("EXCERPT", 500),
    GENRE: textField("GENRE", 120), TYPE: textField("TYPE", 32), CONTENT: textField("CONTENT", 30000)
  };
  const invalid = Object.values(fields).find((v) => typeof v === "string" && v.includes(" must be a non-empty string"));
  if (invalid) return { error: invalid };
  const { BAND, RELEASE, TITLE, EXCERPT, TYPE, CONTENT } = fields;
  const GENRE = canonicalGenre(fields.GENRE);
  if (!GENRE) return { error: "GENRE must match an official site genre. Use the most specific supported sub-genre." };
  if (TITLE.length < 12) return { error: "TITLE must contain at least 12 characters." };
  if (!ALLOWED_TYPES.has(TYPE)) return { error: "TYPE must be Review, News, Feature, or Interview." };
  if (!Array.isArray(value.TAGS) || value.TAGS.length > 12 || value.TAGS.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40)) {
    return { error: "TAGS must be an array of up to 12 non-empty strings (maximum 40 characters each)." };
  }
  let SCORE = null;
  if (value.SCORE !== undefined && value.SCORE !== null && value.SCORE !== "") {
    SCORE = Number(value.SCORE);
    if (!Number.isFinite(SCORE) || SCORE < 0 || SCORE > 10) return { error: "SCORE must be a number from 0 to 10." };
  }
  const words = wordCount(CONTENT);
  if (words < 350 || words > 500) return { error: "CONTENT must contain 350–500 words." };
  const source = sourceFromContent(CONTENT);
  if (!source) return { error: "CONTENT must end with a final line in the form Source: [site](https://source-link)." };
  if (!canonicalSourceUrl(source.url)) return { error: "Source link must be a valid HTTPS URL." };
  const coverKeys = ["image", "cover_url", "cover_image"];
  let COVER_IMAGE_URL = "";
  for (const key of coverKeys) {
    if (value[key] == null || value[key] === "") continue;
    if (typeof value[key] !== "string") return { error: key + " must be a valid http or https URL." };
    const parsed = validHttpUrl(value[key].trim());
    if (!parsed) return { error: key + " must be a valid http or https URL." };
    COVER_IMAGE_URL = parsed;
    break;
  }
  let YOUTUBE_VIDEO_ID = "";
  if (value.youtubeVideoId != null && value.youtubeVideoId !== "") {
    if (typeof value.youtubeVideoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value.youtubeVideoId.trim())) {
      return { error: "youtubeVideoId must contain exactly 11 letters, numbers, underscores, or hyphens." };
    }
    YOUTUBE_VIDEO_ID = value.youtubeVideoId.trim();
  }
  if (value.videoUrl != null && value.videoUrl !== "") {
    if (typeof value.videoUrl !== "string") return { error: "videoUrl must be a valid YouTube URL." };
    const fromUrl = youtubeIdFromUrl(value.videoUrl.trim());
    if (!fromUrl) return { error: "videoUrl must be a valid YouTube URL containing an 11-character video id." };
    if (YOUTUBE_VIDEO_ID && YOUTUBE_VIDEO_ID !== fromUrl) return { error: "youtubeVideoId does not match videoUrl." };
    YOUTUBE_VIDEO_ID = YOUTUBE_VIDEO_ID || fromUrl;
  }
  return { article: { BAND, RELEASE, TITLE, EXCERPT, TAGS: [...new Set(value.TAGS.map((tag) => tag.trim()))], GENRE, TYPE, SCORE, CONTENT, COVER_IMAGE_URL, YOUTUBE_VIDEO_ID } };
}

export function validHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return "";
    return url.toString();
  } catch { return ""; }
}
export function youtubeIdFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (host !== "youtube.com") return "";
    const id = url.searchParams.get("v") || (url.pathname.match(/^\/(?:shorts|embed|live)\//([A-Za-z0-9_-]{11})(?:\\/|$)/) || [])[1] || "";
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  } catch { return ""; }
}

export function parseDailyLimit(value) {
  if (value == null || String(value).trim() === "") return { value: 10 };
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && n <= 1000 ? { value: n } : { error: "AI_PUBLISH_DAILY_LIMIT must be an integer from 1 to 1000." };
}

export function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ai-article";
}

export async function nextAvailableSlug(rest, title) {
  const base = slugify(title).slice(0, 90).replace(/-+$/g, "") || "ai-article";
  for (let n = 1; n <= 100; n++) {
    const candidate = n === 1 ? base : base + "-" + n;
    const params = new URLSearchParams({ select: "id", slug: "eq." + candidate, limit: "1" });
    const response = await rest("articles?" + params.toString());
    if (!response.ok) throw new Error("Could not check article slug availability: " + (await response.text()).slice(0, 180));
    if (!(await response.json()).length) return candidate;
  }
  throw new Error("Could not allocate a unique article slug.");
}

function isSlugConflict(detail) {
  return /duplicate key|unique constraint|articles_slug_key|slug.*already exists/i.test(String(detail || ""));
}

export function wordCount(value) {
  return (String(value || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
}
export function normaliseTitle(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
export function canonicalSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ""; }
}
export function sourceFromContent(content) {
  const lastLine = String(content || "").trim().split(/\r?\n/).at(-1) || "";
  const match = /^Source:\s*\[([^\]\n]{1,120})\]\((https:\/\/[^)\s]+)\)$/.exec(lastLine);
  return match ? { site: match[1], url: match[2] } : null;
}
function contentHasSource(content, sourceUrl) {
  const matches = String(content || "").matchAll(/^Source:\s*\[[^\]]+\]\((https:\/\/[^)\s]+)\)\s*$/gm);
  for (const match of matches) if (canonicalSourceUrl(match[1]) === sourceUrl) return true;
  return false;
}
