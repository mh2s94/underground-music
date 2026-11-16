// GET /api/preview?id=<deezer track id> → redirects to a fresh 30-second preview MP3.
// Deezer preview links are signed and expire, so they are never stored: the player
// asks this endpoint at play time and the browser follows the redirect.
export async function onRequestGet({ request }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^\d{1,15}$/.test(id)) return new Response("Bad id", { status: 400 });
  try {
    const r = await fetch(`https://api.deezer.com/track/${id}`, { signal: AbortSignal.timeout(6000) });
    const t = await r.json();
    const url = t && /^https?:\/\//.test(t.preview || "") ? t.preview.replace(/^http:/, "https:") : null;
    if (!url) return new Response("No preview for this track", { status: 404, headers: { "cache-control": "public, max-age=3600" } });
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, max-age=300" } });
  } catch {
    return new Response("Preview unavailable", { status: 502 });
  }
}
