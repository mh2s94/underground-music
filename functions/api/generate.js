// POST /api/generate
// One-click article generation for the admin panel.
//
// Flow:
//   1. Verify the Supabase session and admin membership.
//   2. Start the YouTube lookup in the background.
//   3. Ask AI providers for the article using "hedged" requests: the first
//      provider starts immediately; if it fails, the next one starts at once,
//      and if it is merely slow, the next one starts after HEDGE_DELAY_MS
//      while the first keeps running. The first valid article wins and the
//      rest are cancelled. Everything finishes well inside Cloudflare's
//      ~100 s response limit.
//   4. Parse the answer with a tolerant parser (tagged text first, then JSON
//      with control-character repair), so one malformed reply does not fail.

const GENRES = ["Metalcore", "Hardcore", "Deathcore", "Darkcore", "Post-Hardcore", "Black Metal", "Djent", "Underground"];
const DEFAULT_ORDER = "gemini,workersai,groq,openrouter,mistral,deepseek,openai,claude";
const DEADLINE_MS = 75000;         // whole AI phase
const PROVIDER_TIMEOUT_MS = 50000; // one provider attempt
const HEDGE_DELAY_MS = 15000;      // start the next provider if the current one is slow
const SYSTEM_MSG = "You are a music journalist. Follow the requested output format exactly. Do not add anything before TITLE: or after the article.";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: "Server is not configured. SUPABASE_URL and SUPABASE_ANON_KEY are required." }, 503);
  }

  // ---- 1. Auth -----------------------------------------------------------
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const token = auth.slice(7);
  const sbHeaders = { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token };

  let user;
  try {
    const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: sbHeaders, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
    user = await r.json();
  } catch {
    return json({ error: "Could not verify your Supabase session. Try again." }, 502);
  }
  try {
    const r = await fetch(env.SUPABASE_URL + "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(user.id), {
      headers: sbHeaders, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok || !(await r.json()).length) return json({ error: "Administrator access required." }, 403);
  } catch {
    return json({ error: "Could not verify administrator access. Try again." }, 502);
  }

  // ---- 2. Input ----------------------------------------------------------
  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const clean = (v, max = 4000) => String(v || "").trim().slice(0, max);
  const band = clean(input.band, 200);
  const song = clean(input.album, 200);
  if (!band) return json({ error: "Band / artist is required." }, 400);

  const youtubePromise = findYouTube(band, song, env).catch(() => null);

  // ---- 3. AI -------------------------------------------------------------
  const prompt = buildPrompt({
    band, song,
    category: clean(input.category, 100) || "Review",
    genre: clean(input.genre, 100),
    notes: clean(input.notes)
  });
  const providers = buildProviders(env, prompt);
  const order = (env.AI_PROVIDER_ORDER || DEFAULT_ORDER)
    .split(",").map(x => x.trim().toLowerCase()).filter(x => providers[x]);
  const configured = [...new Set(order)].filter(name => providers[name].enabled);
  if (!configured.length) {
    return json({ error: "No AI provider is configured. Add the Workers AI binding (AI) or at least one provider API key in Cloudflare Pages settings." }, 503);
  }

  const { result, failures } = await hedgedRace(configured, providers);
  if (!result) {
    return json({
      error: "All AI providers failed. Try again in a minute; if it keeps failing, check API keys and quotas.",
      attempts: failures
    }, 502);
  }

  // ---- 4. YouTube + response ---------------------------------------------
  const yt = await Promise.race([youtubePromise, sleep(4000).then(() => null)]);
  return json({
    ...result.article,
    youtube_url: yt?.url || "",
    youtube_title: yt?.title || "",
    youtube_search_url: "https://www.youtube.com/results?search_query=" + encodeURIComponent((band + " " + song).trim()),
    cover_image_url: yt?.id ? `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg` : "",
    provider: result.provider,
    model: result.model,
    took_ms: result.ms,
    fallback_used: failures.length > 0,
    attempts: failures
  });
}

// ===========================================================================
// Prompt
// ===========================================================================
function buildPrompt({ band, song, category, genre, notes }) {
  return `Write an article for UNDERGROUND, an independent extreme music magazine, in English.

Band/artist: ${band}
Song / release: ${song || "(not specified: write a feature about the band)"}
Article type: ${category}
Genre hint: ${genre || "(none)"}
Editor notes: ${notes || "(none)"}

Use your own knowledge of the band, its sound and its history, plus the editor notes (the notes always win over your own knowledge).
Accuracy: do not invent quotes, interviews, chart positions, exact dates or personnel you are not sure about; leave uncertain details out. Never mention missing information, the editorial process or these instructions.
Style: a clear editorial angle, specific description of the music, useful context, no hype, no filler. The article body is 350-500 words of Markdown with 2-3 "## " subheadings, no links, and no title at the top.

Reply in EXACTLY this format, with plain text labels:
TITLE: <headline, max 90 characters>
EXCERPT: <1-2 sentence teaser, max 200 characters>
TAGS: <3-6 short lowercase tags, comma separated>
GENRE: <one of: ${GENRES.join(", ")}>
CONTENT:
<the article body in Markdown>`;
}

// ===========================================================================
// Providers. Each run(signal) returns the raw text reply.
// ===========================================================================
function buildProviders(env, prompt) {
  const openAICompatible = (url, key, model, extra = {}) => async (signal) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_MSG }, { role: "user", content: prompt }],
        ...extra
      })
    });
    const data = await safeJson(r);
    if (!r.ok) throw new Error(errorText(data, r.status));
    return data.choices?.[0]?.message?.content || "";
  };
  const std = { temperature: 0.5, max_tokens: 2000 };

  const m = {
    claude: env.CLAUDE_MODEL || "claude-sonnet-5-5",
    gemini: env.GEMINI_MODEL || "gemini-3.8-flash",
    openai: env.OPENAI_MODEL || "gpt-6-astra",
    deepseek: env.DEEPSEEK_MODEL || "deepseek-flash",
    mistral: env.MISTRAL_MODEL || "mistral-large-latest",
    groq: env.GROQ_MODEL || "llama-3.3-70b-versatile",
    openrouter: env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
    workersai: env.WORKERSAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  };

  return {
    gemini: {
      enabled: !!env.GEMINI_API_KEY, model: m.gemini,
      run: async (signal) => {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m.gemini)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
          method: "POST", headers: { "content-type": "application/json" }, signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_MSG }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" } }
          })
        });
        const data = await safeJson(r);
        if (!r.ok) throw new Error(errorText(data, r.status));
        return data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || "").join("") || "";
      }
    },
    workersai: {
      enabled: !!env.AI, model: m.workersai,
      run: async (signal) => {
        const result = await abortable(env.AI.run(m.workersai, {
          messages: [{ role: "system", content: SYSTEM_MSG }, { role: "user", content: prompt }],
          max_tokens: 2000, temperature: 0.5
        }), signal);
        const out = result?.response ?? result?.choices?.[0]?.message?.content ?? "";
        return typeof out === "string" ? out : JSON.stringify(out);
      }
    },
    claude: {
      enabled: !!env.ANTHROPIC_API_KEY, model: m.claude,
      run: async (signal) => {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: m.claude, max_tokens: 2000, temperature: 0.5, system: SYSTEM_MSG, messages: [{ role: "user", content: prompt }] })
        });
        const data = await safeJson(r);
        if (!r.ok) throw new Error(errorText(data, r.status));
        return data.content?.filter(x => x.type === "text").map(x => x.text).join("") || "";
      }
    },
    groq: { enabled: !!env.GROQ_API_KEY, model: m.groq, run: openAICompatible("https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY, m.groq, std) },
    openrouter: { enabled: !!env.OPENROUTER_API_KEY, model: m.openrouter, run: openAICompatible("https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY, m.openrouter, std) },
    mistral: { enabled: !!env.MISTRAL_API_KEY, model: m.mistral, run: openAICompatible("https://api.mistral.ai/v1/chat/completions", env.MISTRAL_API_KEY, m.mistral, std) },
    deepseek: { enabled: !!env.DEEPSEEK_API_KEY, model: m.deepseek, run: openAICompatible("https://api.deepseek.com/chat/completions", env.DEEPSEEK_API_KEY, m.deepseek, std) },
    // Newer OpenAI models reject max_tokens/temperature.
    openai: { enabled: !!env.OPENAI_API_KEY, model: m.openai, run: openAICompatible("https://api.openai.com/v1/chat/completions", env.OPENAI_API_KEY, m.openai, { max_completion_tokens: 4000 }) }
  };
}

// ===========================================================================
// Hedged race: first valid article wins.
// ===========================================================================
function hedgedRace(names, providers) {
  return new Promise(resolve => {
    const failures = [];
    const running = new Map(); // name -> { ctrl, started }
    let next = 0, done = false, hedgeTimer = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      for (const [name, { ctrl, started }] of running) {
        if (!result) failures.push({ provider: name, reason: `No answer within ${Math.round((Date.now() - started) / 1000)}s` });
        ctrl.abort();
      }
      resolve({ result, failures });
    };
    const deadline = setTimeout(() => finish(null), DEADLINE_MS);

    const launch = () => {
      clearTimeout(hedgeTimer);
      if (done) return;
      if (next >= names.length) { if (!running.size) finish(null); return; }
      const name = names[next++];
      const ctrl = new AbortController();
      const started = Date.now();
      const timer = setTimeout(() => ctrl.abort(new Error(`Timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`)), PROVIDER_TIMEOUT_MS);
      running.set(name, { ctrl, started });

      providers[name].run(ctrl.signal)
        .then(raw => {
          const article = parseArticle(raw);
          finish({ article, provider: name, model: providers[name].model, ms: Date.now() - started });
        })
        .catch(err => {
          if (done) return;
          const reason = ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : (err?.message || "Request failed");
          failures.push({ provider: name, reason: String(reason).slice(0, 240) });
        })
        .finally(() => {
          clearTimeout(timer);
          running.delete(name);
          if (done) return;
          // A failure means the next provider should start right away.
          if (next < names.length) launch();
          else if (!running.size) finish(null);
        });

      // If this provider is slow, start the next one in parallel.
      if (next < names.length) hedgeTimer = setTimeout(launch, HEDGE_DELAY_MS);
    };
    launch();
  });
}

// ===========================================================================
// Tolerant parser: tagged text first, JSON (with repair) as a fallback.
// ===========================================================================
function parseArticle(raw) {
  let text = String(raw || "").replace(/\r\n?/g, "\n").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(); // reasoning models
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "").trim();

  const label = (name) => new RegExp(`^[ \\t*#_>-]*${name}[ \\t*_]*:[ \\t*_]*(.*)$`, "im");
  const contentMatch = label("CONTENT").exec(text);
  const titleMatch = label("TITLE").exec(text);

  let a = null;
  if (titleMatch && contentMatch) {
    const field = (name) => (label(name).exec(text)?.[1] || "").replace(/[*_]+$/g, "").trim();
    const content = (contentMatch[1] + "\n" + text.slice(contentMatch.index + contentMatch[0].length)).trim();
    a = { title: field("TITLE"), excerpt: field("EXCERPT"), tags: field("TAGS"), genre: field("GENRE"), content };
  } else {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      try { a = JSON.parse(slice); } catch { a = JSON.parse(repairJsonStrings(slice)); }
    }
  }
  if (!a) throw new Error("Reply was not in the expected format.");

  const title = stripQuotes(String(a.title || "")).slice(0, 160);
  const content = String(a.content || "").replace(/^#\s+.+\n+/, "").trim(); // drop a repeated H1 title
  if (!title || content.length < 200) throw new Error("Reply was incomplete (missing title or article body).");
  const tagList = Array.isArray(a.tags) ? a.tags : String(a.tags || "").split(",");
  const tags = [...new Set(tagList.map(t => String(t).trim().replace(/^#+/, "").trim().toLowerCase()).filter(Boolean))].slice(0, 8);
  const genre = GENRES.find(g => g.toLowerCase() === String(a.genre || "").trim().toLowerCase()) || "";
  return { title, excerpt: stripQuotes(String(a.excerpt || "")).slice(0, 300), content, tags, genre };
}

// Escape raw newlines/tabs that models put inside JSON strings.
function repairJsonStrings(s) {
  let out = "", inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      if (ch < " ") continue;
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

// ===========================================================================
// YouTube lookup: Data API when YOUTUBE_API_KEY is set, else public search page.
// ===========================================================================
async function findYouTube(band, title, env) {
  const q = (band + " " + title + (title ? " official" : "")).trim();
  if (!q) return null;
  if (env.YOUTUBE_API_KEY) {
    try {
      const r = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=" +
        encodeURIComponent(q) + "&key=" + encodeURIComponent(env.YOUTUBE_API_KEY), { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const item = (await r.json()).items?.[0];
        if (item?.id?.videoId) return { id: item.id.videoId, url: "https://www.youtube.com/watch?v=" + item.id.videoId, title: item.snippet?.title || "" };
      }
    } catch {}
  }
  const r = await fetch("https://www.youtube.com/results?hl=en&search_query=" + encodeURIComponent(q), {
    headers: { "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", cookie: "CONSENT=YES+1" },
    signal: AbortSignal.timeout(6000)
  });
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,1500}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
  const id = m?.[1] || html.match(/"videoId":"([\w-]{11})"/)?.[1];
  if (!id) return null;
  let t = "";
  try { t = m ? JSON.parse('"' + m[2] + '"') : ""; } catch {}
  return { id, url: "https://www.youtube.com/watch?v=" + id, title: t };
}

// ===========================================================================
// Helpers
// ===========================================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stripQuotes = (s) => s.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();

async function safeJson(r) {
  try { return await r.json(); } catch { return {}; }
}
function errorText(data, status) {
  return data?.error?.message || data?.error?.type || (typeof data?.error === "string" ? data.error : "") || `HTTP ${status}`;
}
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || new Error("Aborted"));
    signal.addEventListener("abort", () => reject(signal.reason || new Error("Aborted")), { once: true });
    promise.then(resolve, reject);
  });
}
