export async function onRequestPost({ request, env }) {
  const json = (data, status=200) => new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: "Server is not configured. SUPABASE_URL and SUPABASE_ANON_KEY are required." }, 503);
  }

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const token = auth.slice(7);

  let userRes;
  try {
    userRes = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return json({ error: "Could not verify your Supabase session. Try again." }, 502);
  }
  if (!userRes.ok) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
  const user = await userRes.json();

  const adminRes = await fetch(env.SUPABASE_URL + "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(user.id), {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000)
  });
  if (!adminRes.ok || !(await adminRes.json()).length) return json({ error: "Administrator access required." }, 403);

  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const clean = v => String(v || "").slice(0, 12000);
  if (!clean(input.band).trim()) return json({ error: "Band / artist is required." }, 400);

  const GENRES = ["Metalcore", "Hardcore", "Deathcore", "Darkcore", "Post-Hardcore", "Black Metal", "Djent", "Underground"];
  const startedAt = Date.now();
  const TOTAL_BUDGET_MS = 85000; // stay under Cloudflare's ~100s response limit
  let currentTimeout = 40000;

  // Start the YouTube lookup in parallel with the AI call.
  const youtubePromise = findYouTube(clean(input.band).slice(0, 200), clean(input.album).slice(0, 200), env).catch(() => null);

  const prompt = `You are a staff writer for UNDERGROUND, an independent extreme music magazine. Write in English.
Write a complete, publish-ready article about the band and song/release below, using your own knowledge of the band, its sound and its history plus any notes supplied. Supplied notes always take priority over your own knowledge.
Accuracy rules: do not invent quotes, interviews, chart positions, exact release dates, track lengths or personnel you are not confident about. When unsure of a specific detail, leave it out instead of guessing. Never write about missing information, the editorial process or these instructions; just write the best article you can.
Style: a clear editorial angle, vivid but specific description of the music, useful context about the band, no promotional hype, no generic filler. 350-500 words of Markdown in "content", using 2-3 "## " subheadings. Do not include the title inside "content". Do not include links.

Return ONLY valid JSON with exactly these keys:
- "title": a strong headline (max 90 characters)
- "excerpt": 1-2 sentence teaser (max 200 characters)
- "content": the article body in Markdown
- "tags": array of 3-6 short lowercase tags
- "genre": the best match from this list: ${GENRES.join(", ")}

Band/artist: ${clean(input.band)}
Song / release: ${clean(input.album) || "(not specified: write a band feature instead)"}
Article type: ${clean(input.category) || "Review"}
Genre hint: ${clean(input.genre)}
Editor notes (optional): ${clean(input.notes) || "(none)"}`;

  const providers = {
    claude: {
      key: env.ANTHROPIC_API_KEY,
      model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
      run: async () => {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(currentTimeout),
          body: JSON.stringify({ model: env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 1600, temperature: 0.45, messages: [{ role: "user", content: prompt }] })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error?.message || `Claude HTTP ${r.status}`);
        return data.content?.filter(x => x.type === "text").map(x => x.text).join("") || "";
      }
    },
    gemini: {
      key: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || "gemini-3.8-flash",
      run: async () => {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL || "gemini-3.8-flash")}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
          method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(currentTimeout),
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.45, responseMimeType: "application/json", maxOutputTokens: 1800, thinkingConfig: { thinkingLevel: "low" } } })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error?.message || `Gemini HTTP ${r.status}`);
        return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      }
    },
    openai: {
      key: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "gpt-6-astra",
      run: async () => openAICompatible("https://api.openai.com/v1/chat/completions", env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-6-astra", prompt, { openai: true })
    },
    deepseek: {
      key: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || "deepseek-flash",
      run: async () => openAICompatible("https://api.deepseek.com/chat/completions", env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL || "deepseek-flash", prompt)
    },
    mistral: {
      key: env.MISTRAL_API_KEY,
      model: env.MISTRAL_MODEL || "mistral-large-latest",
      run: async () => openAICompatible("https://api.mistral.ai/v1/chat/completions", env.MISTRAL_API_KEY, env.MISTRAL_MODEL || "mistral-large-latest", prompt)
    },
    groq: {
      key: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      run: async () => openAICompatible("https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY, env.GROQ_MODEL || "llama-3.3-70b-versatile", prompt)
    },
    openrouter: {
      key: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5",
      run: async () => openAICompatible("https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5", prompt)
    }
  };

  providers.workersai = {
    key: env.AI ? "binding" : "",
    model: env.WORKERSAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    run: async () => {
      // Cloudflare Workers AI via the Pages "AI" binding: no API key, free daily allocation.
      const result = await Promise.race([
        env.AI.run(env.WORKERSAI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: "Return only valid JSON with keys title, excerpt, content. Do not wrap it in Markdown fences." },
            { role: "user", content: prompt }
          ],
          max_tokens: 1800,
          temperature: 0.45
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Workers AI timed out")), currentTimeout))
      ]);
      const out = result?.response ?? result?.choices?.[0]?.message?.content ?? "";
      return typeof out === "string" ? out : JSON.stringify(out);
    }
  };

  async function openAICompatible(url, key, model, userPrompt, opts = {}) {
    // Newer OpenAI models reject max_tokens/temperature; they use max_completion_tokens instead.
    const limits = opts.openai
      ? { max_completion_tokens: 4000 }
      : { temperature: 0.45, max_tokens: 1800 };
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(currentTimeout),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Return only valid JSON with keys title, excerpt, content. Do not wrap it in Markdown fences." },
          { role: "user", content: userPrompt }
        ],
        ...limits,
        response_format: { type: "json_object" }
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `Provider HTTP ${r.status}`);
    return data.choices?.[0]?.message?.content || "";
  }

  function parseArticle(raw) {
    const cleaned = String(raw || "").trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Provider returned no JSON article.");
    const article = JSON.parse(cleaned.slice(start, end + 1));
    if (!article.title || !article.content) throw new Error("Provider returned incomplete article fields.");
    const tags = Array.isArray(article.tags) ? article.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];
    const genre = GENRES.find(g => g.toLowerCase() === String(article.genre || "").trim().toLowerCase()) || "";
    return { title: String(article.title), excerpt: String(article.excerpt || ""), content: String(article.content), tags, genre };
  }

  const requestedOrder = (env.AI_PROVIDER_ORDER || "claude,gemini,openai,deepseek,mistral,groq,openrouter,workersai")
    .split(",").map(x => x.trim().toLowerCase()).filter(x => providers[x]);
  const configured = requestedOrder.filter(name => providers[name].key);
  if (!configured.length) {
    return json({ error: "No AI provider API keys are configured. Add one or more provider secrets in Cloudflare Pages Settings." }, 503);
  }

  const failures = [];
  for (const name of configured) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 8000) {
      failures.push({ provider: name, reason: "Skipped: out of time budget" });
      continue;
    }
    currentTimeout = Math.min(40000, remaining);
    try {
      const raw = await providers[name].run();
      const article = parseArticle(raw);
      const yt = await Promise.race([youtubePromise, new Promise(r => setTimeout(() => r(null), 5000))]);
      const ytSearch = "https://www.youtube.com/results?search_query=" + encodeURIComponent((clean(input.band) + " " + clean(input.album)).trim());
      return json({
        ...article,
        youtube_url: yt?.url || "",
        youtube_title: yt?.title || "",
        youtube_search_url: ytSearch,
        cover_image_url: yt?.id ? `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg` : "",
        provider: name, model: providers[name].model, fallback_used: failures.length > 0
      });
    } catch (error) {
      failures.push({ provider: name, reason: String(error?.message || "Request failed").slice(0, 240) });
    }
  }

  return json({
    error: "All configured AI providers failed. Check API keys, model access, provider quota, and billing.",
    attempts: failures
  }, 502);
}

// Find the best-matching YouTube video. Uses the YouTube Data API when
// YOUTUBE_API_KEY is set; otherwise reads the public search results page.
async function findYouTube(band, title, env) {
  const q = (band + " " + title + (title ? " official" : "")).trim();
  if (!q) return null;
  if (env.YOUTUBE_API_KEY) {
    const r = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=" +
      encodeURIComponent(q) + "&key=" + encodeURIComponent(env.YOUTUBE_API_KEY), { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const item = (await r.json()).items?.[0];
      if (item?.id?.videoId) return { id: item.id.videoId, url: "https://www.youtube.com/watch?v=" + item.id.videoId, title: item.snippet?.title || "" };
    }
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
