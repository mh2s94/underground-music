// POST /api/ai-publish — persist a structured AI-written article from the VPS publisher.
// Protected by AI_PUBLISH_TOKEN. The caller supplies the article; this endpoint does not call an AI provider.
import { same, serviceRest } from "./draft-lib.js";
import { tg, esc, SITE } from "./telegram/lib.js";

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
  const sourceUrl = canonicalSourceUrl(sourceFromContent(article.CONTENT).url);
  const titleKey = normaliseTitle(article.TITLE);
  const mode = String(env.AI_PUBLISH_MODE || "draft").trim().toLowerCase();
  if (!["draft", "review", "published"].includes(mode)) return json({ error: "AI_PUBLISH_MODE must be draft, review, or published." }, 503);

  const svc = serviceRest(env);
  if (svc.error) return json({ error: svc.error }, 503);
  const { rest } = svc;
  const duplicate = await findDuplicate(rest, titleKey, sourceUrl);
  if (duplicate.error) return json({ error: "Could not complete duplicate checks.", detail: duplicate.error }, 503);
  if (duplicate.match) return json({ error: "Duplicate article rejected.", duplicate: duplicate.match }, 409);

  const claim = await rest("ai_ingestion", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      title: article.TITLE, title_key: titleKey, source_url: sourceUrl, status: "processing",
      band: article.BAND || null, release: article.RELEASE || null, genre: article.GENRE,
      article_type: article.TYPE, score: article.SCORE ?? null
    })
  });
  if (!claim.ok) {
    const detail = (await claim.text()).slice(0, 240);
    if (claim.status === 409 || /duplicate key|unique constraint/i.test(detail)) return json({ error: "Duplicate article rejected.", duplicate: "ai_ingestion" }, 409);
    return json({ error: "Could not claim this article in ai_ingestion.", detail }, 503);
  }
  const ingestionId = (await claim.json())?.[0]?.id;
  if (!ingestionId) return json({ error: "ai_ingestion did not return a claim id." }, 503);

  const now = new Date();
  const suffix = await sha256(sourceUrl);
  const slug = slugify(article.TITLE).slice(0, 78).replace(/-+$/g, "") + "-" + suffix.slice(0, 10);
  const row = {
    title: article.TITLE, slug, excerpt: article.EXCERPT, content: article.CONTENT.trim(),
    band_name: article.BAND || null, album_name: article.RELEASE || null, tags: article.TAGS,
    genre: article.GENRE, kind: article.TYPE, score: article.SCORE ?? null,
    status: mode, author_id: null, published_at: mode === "published" ? now.toISOString() : null
  };
  const inserted = await rest("articles", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row)
  });
  if (!inserted.ok) {
    const detail = (await inserted.text()).slice(0, 500);
    await updateClaim(rest, ingestionId, { status: "failed", last_error: detail, updated_at: new Date().toISOString() });
    return json({ error: "Article insert failed.", detail }, 502);
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
        esc(row.title) + "\n" +
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

async function findDuplicate(rest, titleKey, sourceUrl) {
  const query = async (table, filters, select, limit = 5) => {
    const params = new URLSearchParams({ select, ...filters, limit: String(limit) });
    const response = await rest(table + "?" + params.toString());
    if (!response.ok) return { error: table + ": " + (await response.text()).slice(0, 180) };
    return { rows: await response.json() };
  };
  const [recent, newsByUrl, newsByTitle, aiByUrl, aiByTitle] = await Promise.all([
    query("articles", { order: "created_at.desc" }, "title,content", ARTICLE_LIMIT),
    query("news_ingestion", { source_url: "eq." + sourceUrl }, "title,source_url"),
    query("news_ingestion", { title: "ilike." + titleKey.replace(/\s+/g, " ") }, "title,source_url"),
    query("ai_ingestion", { source_url: "eq." + sourceUrl }, "title,source_url"),
    query("ai_ingestion", { title_key: "eq." + titleKey }, "title,title_key,source_url")
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
  const { BAND, RELEASE, TITLE, EXCERPT, GENRE, TYPE, CONTENT } = fields;
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
  return { article: { BAND, RELEASE, TITLE, EXCERPT, TAGS: [...new Set(value.TAGS.map((tag) => tag.trim()))], GENRE, TYPE, SCORE, CONTENT } };
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
function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ai-article";
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
