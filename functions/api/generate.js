export async function onRequestPost({ request, env }) {
  const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.GEMINI_API_KEY) return json({ error: "Server is not configured. Add SUPABASE_URL, SUPABASE_ANON_KEY and GEMINI_API_KEY in Cloudflare Pages environment variables." }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const token = auth.slice(7);
  const userRes = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!userRes.ok) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
  const user = await userRes.json();
  const adminRes = await fetch(env.SUPABASE_URL + "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(user.id), { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token } });
  if (!adminRes.ok || !(await adminRes.json()).length) return json({ error: "Administrator access required." }, 403);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const clean = v => String(v || "").slice(0, 12000);
  const prompt = `You are an editor for an independent underground extreme music magazine. Write in English. Produce accurate, original editorial copy using ONLY the supplied facts. Never invent release dates, track names, labels, quotes, tour dates, personnel, or claims. If information is missing, omit it or clearly flag it as unverified. Avoid promotional hype and generic filler. Return ONLY valid JSON with keys title, excerpt, content. The content should be 450-650 words in Markdown, with a clear editorial angle, useful context, and no fabricated citations.\n\nBand/artist: ${clean(input.band)}\nRelease/topic: ${clean(input.album)}\nGenre: ${clean(input.genre)}\nCategory: ${clean(input.category)}\nVerified source notes: ${clean(input.notes)}`;
  let aiRes;
  let result;
  try {
    aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(env.GEMINI_API_KEY), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.55, responseMimeType: "application/json", maxOutputTokens: 4096 }
      })
    });
    result = await aiRes.json();
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return json({ error: timedOut
      ? "Gemini took longer than 45 seconds to respond. Please try again in a minute; the provider may be busy."
      : "Could not reach Gemini. Check your connection and try again." }, 504);
  }
  if (!aiRes.ok) return json({ error: result.error?.message || "AI provider request failed." }, 502);
  const raw = result.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  try { const article = JSON.parse(raw); if (!article.title || !article.content) throw new Error("Missing article fields"); return json(article); }
  catch { return json({ error: "AI returned an invalid draft. Try again or reduce the source notes." }, 502); }
}
