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

  const prompt = `You are an editor for an independent underground extreme music magazine. Write in English. Produce accurate, original editorial copy using ONLY the supplied facts. Never invent release dates, track names, labels, quotes, tour dates, personnel, or claims. If information is missing, omit it or clearly flag it as unverified. Avoid promotional hype and generic filler. Return ONLY valid JSON with keys title, excerpt, content. The content should be 300-400 words in Markdown, with a clear editorial angle, useful context, and no fabricated citations.

Band/artist: ${clean(input.band)}
Release/topic: ${clean(input.album)}
Genre: ${clean(input.genre)}
Category: ${clean(input.category)}
Verified source notes: ${clean(input.notes)}`;

  const providers = {
    claude: {
      key: env.ANTHROPIC_API_KEY,
      model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
      run: async () => {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(60000),
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
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL || "gemini-3.8-flash")}:generateContent?key=" + encodeURIComponent(env.GEMINI_API_KEY), {
          method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(60000),
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
      run: async () => openAICompatible("https://api.openai.com/v1/chat/completions", env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-6-astra", prompt)
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

  async function openAICompatible(url, key, model, userPrompt) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Return only valid JSON with keys title, excerpt, content. Do not wrap it in Markdown fences." },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.45,
        max_tokens: 1800,
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
    return { title: String(article.title), excerpt: String(article.excerpt || ""), content: String(article.content) };
  }

  const requestedOrder = (env.AI_PROVIDER_ORDER || "claude,gemini,openai,deepseek,mistral,groq,openrouter")
    .split(",").map(x => x.trim().toLowerCase()).filter(x => providers[x]);
  const configured = requestedOrder.filter(name => providers[name].key);
  if (!configured.length) {
    return json({ error: "No AI provider API keys are configured. Add one or more provider secrets in Cloudflare Pages Settings." }, 503);
  }

  const failures = [];
  for (const name of configured) {
    try {
      const raw = await providers[name].run();
      const article = parseArticle(raw);
      return json({ ...article, provider: name, model: providers[name].model, fallback_used: failures.length > 0 });
    } catch (error) {
      failures.push({ provider: name, reason: String(error?.message || "Request failed").slice(0, 240) });
    }
  }

  return json({
    error: "All configured AI providers failed. Check API keys, model access, provider quota, and billing.",
    attempts: failures
  }, 502);
}
