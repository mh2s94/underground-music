// POST /api/telegram/autopilot — Scene Radar autopilot. Called by GitHub Actions right after each
// digest (.github/workflows/telegram-digest.yml), once per article, so each call stays short.
//
// For the best headline the digest just sent (score >= AUTOPILOT_MIN_SCORE, not handled yet):
//   1. read the source page (falls back to the headline + summary),
//   2. a writer AI writes a news piece from the source only,
//   3. a checker AI from another company compares it with the source,
//   4. checks without AI: band, release, numbers, quotes, names must be in the source; no copying,
//   5. problems go back to the writer (max AUTOPILOT_ROUNDS fixes), then 3-4 again,
//   6. all passed -> PUBLISHED and the editor gets a Telegram note with [↩️ Tarik];
//      otherwise nothing is published and the editor gets a short note (the headline stays
//      available for ✍️ Tulis draft).
// Limits: AUTOPILOT_DAILY (default 5) articles a day (Jayapura time). AUTOPILOT=off switches it off.
// Auth: Authorization: Bearer <AUTODRAFT_TOKEN>.
// ?dry=1: test run. Uses the newest scored headline (any status), runs every step, and only
// returns the result as JSON: nothing is saved, published or sent to Telegram.

import { same, serviceRest, firstAdmin, slugify } from "../draft-lib.js";
import { buildProviders, parseArticle, findYouTube } from "../generate.js";
import { PROMPT_LIST } from "../genres-data.js";
import { SITE, tg, esc } from "./lib.js";
import { extractText, wordCount, factGate, writerPrompt, reviserPrompt, checkerPrompt, parseVerdict, youtubeMatches, startOfDayWIT, pickRoles } from "../autopilot-core.js";

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const NAMES = { gemini: "Gemini", workersai: "Llama (Cloudflare)", groq: "Llama (Groq)", claude: "Claude", openai: "OpenAI", mistral: "Mistral", deepseek: "DeepSeek", openrouter: "OpenRouter", cfmistral: "Mistral Small (Cloudflare)", cfqwen: "Qwen3 (Cloudflare)", cfgemma: "Gemma 4 (Cloudflare)" };
// Extra Workers AI models from other companies (same AI binding, no extra key)
const CF_EXTRA = { cfmistral: "@cf/mistralai/mistral-small-3.1-24b-instruct", cfqwen: "@cf/qwen/qwen3-30b-a3b-fp8", cfgemma: "@cf/google/gemma-4-26b-a4b-it" };
function providersFor(env, prompt, system, opts = {}) {
  const p = buildProviders(env, prompt, system, opts);
  for (const [name, model] of Object.entries(CF_EXTRA)) {
    p[name] = {
      enabled: !!env.AI, model,
      run: async (signal) => {
        const res = await Promise.race([
          env.AI.run(model, { messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: opts.maxTokens ?? 2000, temperature: opts.temperature ?? 0.3 }),
          new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason || new Error("aborted")), { once: true }))
        ]);
        const out = res?.response ?? res?.choices?.[0]?.message?.content ?? "";
        return (typeof out === "string" ? out : JSON.stringify(out)).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      }
    };
  }
  return p;
}
const CALL_MS = 45000, BUDGET_MS = 200000;

async function readSource(link) {
  try {
    const r = await fetch(link, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; UNDERGROUND-radar/1.0; +https://music.mikasa.me)", accept: "text/html,application/xhtml+xml", "accept-language": "en" },
      redirect: "follow", signal: AbortSignal.timeout(9000)
    });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") || "")) return "";
    const html = (await r.text()).slice(0, 1500000);
    return extractText(html);
  } catch { return ""; }
}

// Ask providers in order (no racing: saves quota). Returns { text, provider } or throws.
async function ask(env, names, prompt, system, opts, deadline) {
  const providers = providersFor(env, prompt, system, opts);
  const errors = [];
  for (const name of names) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new Error("timeout")), Math.min(CALL_MS, left));
    try {
      const text = await providers[name].run(ctrl.signal);
      if (text && text.trim()) return { text, provider: name };
      errors.push(name + ": empty answer");
    } catch (e) { errors.push(name + ": " + String(e?.message || e).slice(0, 90)); }
    finally { clearTimeout(t); }
  }
  throw new Error("No AI answered (" + errors.join("; ") + ")");
}

export async function onRequestPost({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.AUTODRAFT_TOKEN || !auth || !same(auth, env.AUTODRAFT_TOKEN)) return json({ error: "Not allowed." }, 401);
  if (String(env.AUTOPILOT || "on").toLowerCase() === "off") return json({ done: true, note: "Autopilot is switched off (AUTOPILOT=off)." });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ error: "Telegram is not configured." }, 503);
  const svc = serviceRest(env);
  if (svc.error) return json({ error: svc.error }, 503);
  const { rest } = svc;
  const started = Date.now(), deadline = started + BUDGET_MS;
  const daily = Math.max(0, Math.min(20, Number(env.AUTOPILOT_DAILY || 5)));
  const minScore = Math.max(0, Math.min(10, Number(env.AUTOPILOT_MIN_SCORE || 7)));
  const rounds = Math.max(0, Math.min(3, Number(env.AUTOPILOT_ROUNDS || 2)));
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  // 1. Daily limit (Jayapura day)
  const since = startOfDayWIT();
  const cnt = await rest(`telegram_radar?select=hash&item->auto->>result=eq.published&updated_at=gte.${encodeURIComponent(since)}`);
  const publishedToday = cnt.ok ? (await cnt.json()).length : 0;
  if (publishedToday >= daily && !dry) return json({ done: true, published_today: publishedToday, note: `Daily limit reached (${daily}).` });

  // 2. Best fresh headline from the digest, not handled by the autopilot yet; claim it
  const fresh = new Date(Date.now() - 36 * 3600000).toISOString();
  const q = dry
    ? await rest(`telegram_radar?select=hash,item,sent_at&item->auto=is.null&order=sent_at.desc&limit=30`)
    : await rest(`telegram_radar?select=hash,item,sent_at&status=eq.sent&item->auto=is.null&sent_at=gte.${encodeURIComponent(fresh)}&order=sent_at.desc&limit=30`);
  if (!q.ok) return json({ error: "Could not read telegram_radar.", detail: (await q.text()).slice(0, 200) }, 502);
  const cands = (await q.json()).filter((r) => Number(r.item?.score) >= minScore).sort((a, b) => Number(b.item.score) - Number(a.item.score));
  if (!cands.length) return json({ done: true, published_today: publishedToday, note: "No headline good enough for the autopilot." });
  let row = dry ? cands[0] : null;
  for (const c of dry ? [] : cands) {
    const r = await rest(`telegram_radar?hash=eq.${c.hash}&status=eq.sent&item->auto=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "writing", updated_at: new Date().toISOString() }) });
    const got = r.ok ? await r.json() : [];
    if (got.length) { row = got[0]; break; }
  }
  if (!row) return json({ done: true, note: "Everything was already taken." });
  const n = row.item || {};
  const log = { hash: row.hash, title: n.title, steps: [] };

  // Finish: write the outcome on the radar row (status back to "sent" when not published, so ✍️ Tulis draft still works)
  const finish = async (auto, status, article_id = null) => {
    if (dry) return;
    const item = { ...n, auto: { ...auto, at: new Date().toISOString() } };
    await rest(`telegram_radar?hash=eq.${row.hash}`, { method: "PATCH", body: JSON.stringify({ status, item, ...(article_id ? { article_id } : {}), updated_at: new Date().toISOString() }) });
  };
  const reject = async (reason, extra = {}) => {
    if (dry) return json({ dry: true, published: false, reason, ...extra, ...log });
    reason = String(reason).slice(0, 300);
    await finish({ result: "rejected", reason: String(reason).slice(0, 400), ...extra }, "sent");
    await tg(env, "sendMessage", {
      chat_id: env.TELEGRAM_CHAT_ID, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      text: `🤖 <b>Tidak ditayangkan</b> (gagal cek fakta)\n${esc(n.title)}\n<i>${esc(String(reason).slice(0, 300))}</i>\n<a href="${esc(n.link)}">sumber ↗</a>`,
      reply_markup: { inline_keyboard: [[{ text: "✍️ Tulis draft manual", callback_data: "d:" + row.hash }]] }
    });
    return json({ done: false, published: false, reason, ...log });
  };

  try {
    // 3. Source text
    const text = await readSource(n.link);
    const srcWords = wordCount([n.title, n.summary, text].join(" "));
    log.source_words = srcWords;
    if (srcWords < 60) return await reject(`Sumber terlalu pendek untuk ditulis tanpa menebak (${srcWords} kata).`);
    const minWords = wordCount(text) >= 150 ? 150 : 100;
    const src = { title: n.title, summary: n.summary, text, source: n.source };

    // 4. Who writes, who checks
    const all = providersFor(env, "", "");
    const enabled = Object.keys(all).filter((k) => all[k].enabled);
    const roles = pickRoles(enabled);
    if (!roles.writers.length) return await reject("Tidak ada AI penulis yang aktif.");
    const SYS_W = "You are a careful music news writer. You only state facts given to you. Follow the output format exactly.";
    const SYS_C = "You are a strict fact checker. Reply with JSON only.";

    let w = await ask(env, roles.writers, writerPrompt(n, text, PROMPT_LIST), SYS_W, { temperature: 0.3 }, deadline);
    let draft = parseArticle(w.text);
    log.writer = w.provider; log.steps.push("written by " + w.provider);
    const checkers = roles.checkersFor(w.provider);
    if (!checkers.length) return await reject("Tidak ada AI pemeriksa dari perusahaan lain yang aktif.");

    let checker = "", round = 0, last = [];
    for (;;) {
      const gate = factGate(draft, src, { minWords });
      const c = await ask(env, checkers, checkerPrompt(n, text, draft), SYS_C, { temperature: 0, maxTokens: 900 }, deadline);
      checker = c.provider;
      const v = parseVerdict(c.text);
      last = [...v.problems, ...gate.problems];
      log.steps.push(`round ${round}: checker ${c.provider} ${v.pass ? "pass" : "fail (" + v.problems.length + ")"}, gate ${gate.ok ? "pass" : "fail (" + gate.problems.length + ")"}`);
      if (v.pass && gate.ok) break;
      if (round >= rounds) return await reject("Masih ada masalah setelah " + rounds + " putaran koreksi: " + last.slice(0, 3).join(" · "), { writer: w.provider, checker, problems: last.slice(0, 10) });
      round++;
      const fix = await ask(env, [w.provider, ...roles.writers.filter((x) => x !== w.provider)], reviserPrompt(n, text, PROMPT_LIST, draft, last), SYS_W, { temperature: 0.2 }, deadline);
      draft = parseArticle(fix.text);
      log.steps.push("revised by " + fix.provider);
    }

    if (dry) return json({ dry: true, would_publish: true, rounds: round, writer: w.provider, checker, ms: Date.now() - started, article: { band: draft.band, release: draft.release, title: draft.title, excerpt: draft.excerpt, genre: draft.genre, words: wordCount(draft.content), content: draft.content }, ...log });

    // 5. Publish
    const author = await firstAdmin(rest);
    let category_id = null;
    try { category_id = (await (await rest(`categories?select=id&slug=eq.${encodeURIComponent(slugify(draft.genre || "Underground"))}`)).json())[0]?.id || null; } catch {}
    let yt = null;
    try { yt = await Promise.race([findYouTube(draft.band, draft.release, env), new Promise((r) => setTimeout(() => r(null), 7000))]); } catch {}
    const ytOk = yt && youtubeMatches(yt.title, draft.band, draft.release);
    let content = `${draft.content}\n\nSource: [${n.source}](${n.link})`;
    if (ytOk) content += "\n\n" + yt.url;
    const now = new Date().toISOString();
    const article = {
      title: draft.title, slug: slugify(draft.title), excerpt: draft.excerpt || "", content,
      band_name: draft.band, album_name: draft.release || "", genre: draft.genre || "Underground", category_id,
      cover_image_url: /^https:\/\//.test(n.image || "") ? n.image : (ytOk ? `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg` : null),
      tags: draft.tags || [], status: "published", published_at: now, updated_at: now, author_id: author, kind: "News", score: null
    };
    const insert = (a) => rest("articles?select=id,title,slug", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(a) });
    let r = await insert(article);
    if (r.status === 409) { article.slug = article.slug.slice(0, 80) + "-" + Math.random().toString(36).slice(2, 6); r = await insert(article); }
    if (!r.ok) { const t = await r.text(); if (/kind|score/i.test(t)) { delete article.kind; delete article.score; r = await insert(article); } else return await reject("Gagal menyimpan artikel: " + t.slice(0, 160)); }
    if (!r.ok) return await reject("Gagal menyimpan artikel: " + (await r.text()).slice(0, 160));
    const saved = (await r.json())[0];
    await finish({ result: "published", writer: w.provider, checker, rounds: round }, "drafted", String(saved.id));

    const url = `${SITE}/a/${encodeURIComponent(saved.slug || saved.id)}`;
    await tg(env, "sendMessage", {
      chat_id: env.TELEGRAM_CHAT_ID, parse_mode: "HTML", link_preview_options: { url, prefer_large_media: false },
      text: `🤖 <b>Tayang otomatis</b>\n<b>${esc(saved.title)}</b>\n${url}\n\nDitulis: ${esc(NAMES[w.provider] || w.provider)} · Diperiksa: ${esc(NAMES[checker] || checker)}${round ? ` · ${round} putaran koreksi` : ""}\nSumber: <a href="${esc(n.link)}">${esc(n.source || "sumber")} ↗</a> · ${publishedToday + 1}/${daily} hari ini`,
      reply_markup: { inline_keyboard: [[{ text: "↩️ Tarik (jadi draft)", callback_data: "u:" + saved.id }, { text: "✏️ Edit", url: `${SITE}/admin.html#edit=${encodeURIComponent(saved.id)}` }]] }
    });
    return json({ done: publishedToday + 1 >= daily, published: true, url, rounds: round, writer: w.provider, checker, ms: Date.now() - started, ...log });
  } catch (e) {
    return await reject("Proses AI gagal: " + String(e?.message || e).slice(0, 600));
  }
}
