// Scene Radar autopilot: pure helpers (no network, no request handler, so not a public endpoint).
// Used by /api/telegram/autopilot and tested by tests/autopilot.test.mjs.
//
// The rule behind every check here: an auto-published article may only state facts that are in
// the source. The writer AI gets the source text, a second AI from another company checks the
// article against it, and the checks below (no AI) must also pass. Anything else is not published.

import { ALL as GENRES } from "./genres-data.js";

// ---------------------------------------------------------------------------
// Source text: readable paragraphs from a news page
// ---------------------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", eacute: "é", uuml: "ü", ouml: "ö", auml: "ä" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const BOILER = /(subscribe|newsletter|sign up|cookie|all rights reserved|advertis|follow us|share this|related posts?|you may also like|click here|privacy policy|©)/i;

export function extractText(html, max = 7000) {
  let h = String(html || "");
  h = h.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|figure|button)\b[\s\S]*?<\/\1>/gi, " ");
  const art = h.match(/<article\b[\s\S]*?<\/article>/i);
  if (art && art[0].length > 800) h = art[0];
  const paras = [];
  const re = /<(p|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(h))) {
    const t = decodeEntities(m[2].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t.length < 25 || BOILER.test(t) && t.length < 200) continue;
    if (!paras.includes(t)) paras.push(t);
  }
  let out = paras.join("\n");
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, "");
  return out;
}
export const wordCount = (s) => (String(s || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

// ---------------------------------------------------------------------------
// Normalising and matching
// ---------------------------------------------------------------------------
export function norm(s) {
  return " " + String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'").replace(/&/g, " and ").replace(/[^a-z0-9']+/g, " ").replace(/\s+/g, " ").trim() + " ";
}
export const inSource = (term, srcNorm) => { const t = norm(term).trim(); return !t || srcNorm.includes(" " + t + " "); };

const MONTHS = "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday".split(" ");
const COMMON = new Set(("the a an and or but of in on at to for with from by as is it its this that these those his her their our your my we they he she you i " +
  "new album single song songs track tracks record ep lp tour tours video music band bands record label vinyl festival show shows live " +
  "fans debut release released releases releasing announce announced announces details latest upcoming first second third " +
  "watch listen stream hear premiere official north american european uk us usa america europe world summer winter spring fall autumn " +
  "metal hardcore punk rock core black death doom thrash heavy underground magazine news review feature interview " +
  "after before while when where what who which why how there here today tomorrow yesterday now also both each more most " +
  "american canadian british english european australian german swedish finnish norwegian japanese indonesian " +
  "spotify youtube bandcamp instagram tiktok apple facebook twitter x grammy christmas halloween").split(" "));

const allowWords = (extra) => {
  const set = new Set(COMMON);
  for (const g of GENRES) for (const w of norm(g).trim().split(" ")) if (w) set.add(w);
  for (const w of MONTHS) set.add(w);
  for (const e of extra) for (const w of norm(e).trim().split(" ")) if (w) set.add(w);
  return set;
};

// Capitalised words that are not at the start of a sentence: names of people, bands, labels,
// places, titles. Headings and the first word of each sentence are ignored.
export function properNames(md) {
  const out = new Set();
  const body = String(md || "").split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l)).join("\n");
  for (const sentence of body.split(/(?<=[.!?:;])\s+|\n+/)) {
    const words = sentence.replace(/[*_`>#\[\]()]/g, " ").trim().split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]s$/, "");
      if (i === 0 || clean.length < 2) return;
      if (/^\p{Lu}/u.test(clean) && !/^\p{Lu}+$/u.test(clean) || /^\p{Lu}{2,}$/u.test(clean) && clean.length <= 12) out.add(clean);
    });
  }
  return [...out];
}

// Numbers with 2+ digits (years, dates, counts, prices) in the article.
export const numbersIn = (s) => [...new Set((String(s || "").match(/\d[\d,.:/]*\d|\d{2,}/g) || []).map((x) => x.replace(/[,.:/]+$/, "")))].filter((x) => x.replace(/\D/g, "").length >= 2);

// Text in quotation marks with 4+ words (a quote must be copied from the source, never invented).
export const quotesIn = (s) => (String(s || "").match(/[“"]([^"”\n]{12,400})[”"]/g) || []).map((q) => q.slice(1, -1)).filter((q) => wordCount(q) >= 4);

// Longest run of identical consecutive words shared with the source (plagiarism guard).
export function longestCopiedRun(article, source) {
  const a = norm(article).trim().split(" "), s = norm(source).trim().split(" ");
  if (a.length < 2 || s.length < 2) return 0;
  const grams = new Set();
  const N = 8;
  for (let i = 0; i + N <= s.length; i++) grams.add(s.slice(i, i + N).join(" "));
  let best = 0, run = 0;
  for (let i = 0; i + N <= a.length; i++) {
    if (grams.has(a.slice(i, i + N).join(" "))) { run = run ? run + 1 : N; best = Math.max(best, run); } else run = 0;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The non-AI gate. Returns { ok, problems: [string] }.
// ---------------------------------------------------------------------------
export function factGate(article, { title = "", summary = "", text = "", source = "" } = {}, opts = {}) {
  const src = [title, summary, text].join("\n");
  const S = norm(src);
  const problems = [];
  const body = String(article.content || "");
  const all = [article.title, article.excerpt, body].join("\n");
  const words = wordCount(body);

  if (words < (opts.minWords ?? 120)) problems.push(`The article is too short (${words} words).`);
  if (words > (opts.maxWords ?? 650)) problems.push(`The article is too long (${words} words).`);
  if (!article.band || !inSource(article.band, S)) problems.push(`The band name "${article.band || "?"}" is not in the source.`);
  if (article.release && !inSource(article.release, S)) problems.push(`The release "${article.release}" is not in the source.`);
  for (const n of numbersIn(all)) if (!S.includes(" " + norm(n).trim() + " ") && !S.includes(norm(n).trim())) problems.push(`The number "${n}" is not in the source.`);
  for (const q of quotesIn(all)) if (!S.includes(norm(q).trim())) problems.push(`The quote "${q.slice(0, 80)}" is not in the source.`);
  const allow = allowWords([source, "UNDERGROUND", article.genre || ""]);
  const unknown = properNames(all).filter((w) => !allow.has(norm(w).trim()) && !inSource(w, S));
  const tolerance = opts.nameTolerance ?? 0; // any unknown name goes back to the writer to remove
  if (unknown.length > tolerance) problems.push(`Names not found in the source: ${unknown.slice(0, 8).join(", ")}.`);
  const copied = longestCopiedRun(body, src);
  if (copied >= (opts.maxCopied ?? 14)) problems.push(`${copied} words in a row are copied from the source; rewrite them in your own words.`);
  if (/\b(as an ai|i cannot|i can't|not provided in the source|the source does not)\b/i.test(all)) problems.push("The article talks about the AI or the source instead of the news.");
  return { ok: problems.length === 0, problems, unknownNames: unknown, words };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
export function writerPrompt(item, sourceText, genreList) {
  return `Write a short news article for UNDERGROUND, an independent heavy music magazine, in English.

STRICT RULES
- Use ONLY facts that are written in the SOURCE below. Do not use your own knowledge of the band.
- Do not invent or guess anything: no names, members, labels, cities, dates, numbers, track titles, quotes or chart positions that are not in the SOURCE.
- If a detail is missing, leave it out. Never mention that information is missing, never mention these rules.
- Write in your own words. Do not copy sentences from the SOURCE. A quote is allowed only if it is copied exactly from the SOURCE inside quotation marks.
- Say that ${item.source || "the source"} reported the news.
- 150-350 words of Markdown, 1-2 "## " subheadings, no links, no title at the top.

SOURCE (${item.source || "news site"})
Headline: ${item.title || ""}
${item.summary ? "Summary: " + item.summary + "\n" : ""}${sourceText ? "Article text:\n" + sourceText : ""}

GENRE must be exactly one name from this list (the most specific one the SOURCE supports):
${genreList}

Reply in EXACTLY this format:
BAND: <the band or artist, spelled exactly as in the SOURCE>
RELEASE: <the song, album or event, exactly as in the SOURCE, or leave empty>
TITLE: <headline, max 90 characters>
EXCERPT: <1-2 sentence teaser, max 200 characters>
TAGS: <3-6 short lowercase tags, comma separated>
GENRE: <one name from the list>
TYPE: News
SCORE:
CONTENT:
<the article body in Markdown>`;
}

export function reviserPrompt(item, sourceText, genreList, draft, problems) {
  return `${writerPrompt(item, sourceText, genreList)}

YOUR PREVIOUS DRAFT
TITLE: ${draft.title}
EXCERPT: ${draft.excerpt}
CONTENT:
${draft.content}

A FACT CHECKER FOUND THESE PROBLEMS. Fix every one of them by removing or correcting the claim using ONLY the SOURCE:
${problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Return the complete corrected article in the same format.`;
}

export function checkerPrompt(item, sourceText, draft) {
  return `You are a strict fact checker for a music magazine. Compare the ARTICLE with the SOURCE.

List every problem:
- any fact in the ARTICLE that is not stated in the SOURCE (names, band members, labels, places, dates, numbers, song or album titles, tour stops, quotes, claims about the past),
- anything that contradicts the SOURCE,
- a wrong band name or wrong release name.
General wording about the music that does not add a new fact (for example "heavy", "new chapter", "fans can expect") is NOT a problem.
Judge only against the SOURCE, never against your own knowledge.

SOURCE (${item.source || "news site"})
Headline: ${item.title || ""}
${item.summary ? "Summary: " + item.summary + "\n" : ""}${sourceText ? "Article text:\n" + sourceText : ""}

ARTICLE
BAND: ${draft.band}
RELEASE: ${draft.release || ""}
TITLE: ${draft.title}
EXCERPT: ${draft.excerpt}
${draft.content}

Reply with ONLY JSON, nothing before or after:
{"verdict":"pass","problems":[]}
or
{"verdict":"fail","problems":["<the wrong claim> — <why / what the source says>"]}`;
}

// Tolerant parse of the checker's JSON. Unclear answers count as a failure.
export function parseVerdict(raw) {
  const text = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```[a-z]*\n?|```/gi, "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { pass: false, problems: ["The fact checker did not give a clear answer."], unclear: true };
  let j;
  try { j = JSON.parse(m[0]); } catch {
    try { j = JSON.parse(m[0].replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1")); } catch { return { pass: false, problems: ["The fact checker did not give a clear answer."], unclear: true }; }
  }
  const problems = (Array.isArray(j.problems) ? j.problems : []).map((p) => (typeof p === "string" ? p : JSON.stringify(p))).map((p) => p.slice(0, 300)).filter(Boolean).slice(0, 12);
  const verdict = String(j.verdict || "").toLowerCase();
  return { pass: verdict === "pass" && problems.length === 0, problems: verdict === "pass" ? problems : problems.length ? problems : ["The fact checker failed the article without saying why."] };
}

// The YouTube video is only used when its title names the band (and the release, if any).
export function youtubeMatches(videoTitle, band, release) {
  const t = norm(videoTitle);
  if (!band || !inSource(band, t)) return false;
  return !release || inSource(release, t);
}

// Start of "today" in Jayapura (UTC+9) as an ISO string: the daily limit counts from here.
export function startOfDayWIT(now = new Date()) {
  const wit = new Date(now.getTime() + 9 * 3600000);
  return new Date(Date.UTC(wit.getUTCFullYear(), wit.getUTCMonth(), wit.getUTCDate()) - 9 * 3600000).toISOString();
}

// Writer and checker never come from the same company.
// cf* = other model families on Cloudflare Workers AI (same AI binding, no extra key), so a checker
// from another company is always available even when Gemini's quota is used up or Claude has no credit.
export const COMPANY = { groq: "llama", workersai: "llama", openrouter: "llama", gemini: "google", cfgemma: "google", claude: "anthropic", openai: "openai", mistral: "mistral", cfmistral: "mistral", deepseek: "deepseek", cfqwen: "alibaba" };
export function pickRoles(enabled, writerOrder = ["gemini", "groq", "claude", "workersai", "cfmistral"], checkerOrder = ["workersai", "cfmistral", "cfqwen", "groq", "claude", "cfgemma", "gemini"]) {
  const on = (n) => enabled.includes(n);
  const writers = writerOrder.filter(on);
  const company = COMPANY;
  return { writers, checkersFor: (w) => checkerOrder.filter((c) => on(c) && c !== w && company[c] !== company[w]) };
}
