// /api/music/* — music files on Cloudflare R2 (binding: MUSIC)
//
//   GET    /api/music/status                → { r2: true|false, maxBytes }
//   GET    /api/music/file/<audio|covers>/… → streams the file (Range requests supported, for seeking)
//   PUT    /api/music/upload?folder=audio|covers&ext=mp3   (admin)  body = the file
//   POST   /api/music/mpu/create?folder=audio&ext=mp3  (admin)  header x-file-size → { key, uploadId }
//   PUT    /api/music/mpu/part?key=&uploadId=&part=1   (admin)  body = one chunk → { partNumber, etag }
//   POST   /api/music/mpu/complete { key, uploadId, parts }  (admin) → { key, url, size }
//   POST   /api/music/mpu/abort    { key, uploadId }         (admin)
//   POST   /api/music/delete  { keys: [...] }                       (admin)
//   POST   /api/music/purge                                         (admin) deletes every music file
//
// Streaming from R2 has no egress fees. Admin routes verify the Supabase session
// and admin_users membership, exactly like /api/generate.

const MAX_BYTES = 100 * 1024 * 1024;   // per file
const SINGLE_PUT_MAX = 95 * 1024 * 1024; // one-request uploads stay under Cloudflare's 100 MB body limit
const PART_MAX = 50 * 1024 * 1024;
const FOLDERS = new Set(["audio", "covers"]);
const AUDIO_TYPES = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav|flac)$/i;
const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/i;
const KEY_RE = /^(audio|covers)\/[A-Za-z0-9-]{8,64}\.[a-z0-9]{2,5}$/;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/").filter(Boolean);
  const route = parts[0] || "";
  const method = request.method;

  if (route === "status" && method === "GET") return json({ r2: !!env.MUSIC, maxBytes: MAX_BYTES, chunkBytes: 10 * 1024 * 1024 });

  if (route === "file" && (method === "GET" || method === "HEAD")) return serveFile(request, env, parts.slice(1).join("/"));

  if (!env.MUSIC) return json({ error: "R2 storage is not connected. Add an R2 binding named MUSIC in Cloudflare Pages settings." }, 503);

  if (route === "upload" && (method === "PUT" || method === "POST")) {
    const denied = await requireAdmin(request, env); if (denied) return denied;
    return upload(request, env);
  }
  if (route === "mpu") {
    const denied = await requireAdmin(request, env); if (denied) return denied;
    return multipart(request, env, parts[1] || "", method);
  }
  if (route === "delete" && method === "POST") {
    const denied = await requireAdmin(request, env); if (denied) return denied;
    let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const keys = (Array.isArray(body?.keys) ? body.keys : []).filter((k) => KEY_RE.test(String(k))).slice(0, 1000);
    if (keys.length) await env.MUSIC.delete(keys);
    return json({ deleted: keys.length });
  }
  if (route === "purge" && method === "POST") {
    const denied = await requireAdmin(request, env); if (denied) return denied;
    let deleted = 0;
    for (const prefix of ["audio/", "covers/"]) {
      let cursor;
      for (let guard = 0; guard < 200; guard++) {
        const page = await env.MUSIC.list({ prefix, cursor, limit: 1000 });
        const keys = page.objects.map((o) => o.key);
        if (keys.length) { await env.MUSIC.delete(keys); deleted += keys.length; }
        if (!page.truncated) break;
        cursor = page.cursor;
      }
    }
    return json({ deleted });
  }
  return json({ error: "Not found." }, 404);
}

// ---------------------------------------------------------------------------
function checkNew(request, size) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") || "";
  const ext = (url.searchParams.get("ext") || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!FOLDERS.has(folder)) return { error: json({ error: "Unknown folder." }, 400) };
  if (ext.length < 2) return { error: json({ error: "Missing file extension." }, 400) };
  if (folder === "audio" && !AUDIO_TYPES.test(type)) return { error: json({ error: "Only audio files (MP3, M4A, AAC, OGG, WAV, FLAC) can be uploaded." }, 415) };
  if (folder === "covers" && !IMAGE_TYPES.test(type)) return { error: json({ error: "Covers must be JPG, PNG or WebP." }, 415) };
  if (!size) return { error: json({ error: "Missing file size." }, 411) };
  if (size > MAX_BYTES) return { error: json({ error: `File too large. The limit is ${MAX_BYTES / 1048576} MB per song.` }, 413) };
  return { url, type, key: `${folder}/${crypto.randomUUID()}.${ext}` };
}

async function multipart(request, env, action, method) {
  if (action === "create" && method === "POST") {
    const c = checkNew(request, Number(request.headers.get("x-file-size") || 0));
    if (c.error) return c.error;
    const mpu = await env.MUSIC.createMultipartUpload(c.key, {
      httpMetadata: { contentType: c.type, cacheControl: "public, max-age=31536000, immutable" }
    });
    return json({ key: mpu.key, uploadId: mpu.uploadId });
  }
  if (action === "part" && method === "PUT") {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "", uploadId = url.searchParams.get("uploadId") || "";
    const n = Number(url.searchParams.get("part"));
    if (!KEY_RE.test(key) || !uploadId || !Number.isInteger(n) || n < 1 || n > 100) return json({ error: "Bad part request." }, 400);
    if (Number(request.headers.get("content-length") || 0) > PART_MAX) return json({ error: "Chunk too large." }, 413);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > PART_MAX) return json({ error: "Chunk is empty or too large." }, 413);
    const part = await env.MUSIC.resumeMultipartUpload(key, uploadId).uploadPart(n, buf);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const key = String(body?.key || ""), uploadId = String(body?.uploadId || "");
  if (!KEY_RE.test(key) || !uploadId) return json({ error: "Bad multipart request." }, 400);
  const mpu = env.MUSIC.resumeMultipartUpload(key, uploadId);
  if (action === "abort" && method === "POST") { await mpu.abort().catch(() => {}); return json({ aborted: true }); }
  if (action === "complete" && method === "POST") {
    const list = (Array.isArray(body.parts) ? body.parts : []).slice(0, 100)
      .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || "") }))
      .filter((p) => Number.isInteger(p.partNumber) && p.etag);
    if (!list.length) return json({ error: "No parts uploaded." }, 400);
    const obj = await mpu.complete(list);
    if (obj.size > MAX_BYTES) { await env.MUSIC.delete(key); return json({ error: `File too large. The limit is ${MAX_BYTES / 1048576} MB per song.` }, 413); }
    return json({ key, url: new URL("/api/music/file/" + key, new URL(request.url).origin).toString(), size: obj.size });
  }
  return json({ error: "Not found." }, 404);
}

async function upload(request, env) {
  const size = Number(request.headers.get("content-length") || 0);
  const c = checkNew(request, size);
  if (c.error) return c.error;
  if (size > SINGLE_PUT_MAX) return json({ error: "Large files must use the chunked upload (mpu)." }, 413);
  if (!request.body) return json({ error: "Empty upload." }, 400);
  const { url, type, key } = c;
  await env.MUSIC.put(key, request.body, {
    httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" }
  });
  return json({ key, url: new URL("/api/music/file/" + key, url.origin).toString(), size });
}

async function serveFile(request, env, key) {
  if (!env.MUSIC) return new Response("Storage not connected", { status: 503 });
  if (!KEY_RE.test(key)) return new Response("Not found", { status: 404 });
  const object = await env.MUSIC.get(key, { range: request.headers, onlyIf: request.headers });
  if (object === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");

  // Precondition matched (If-None-Match etc.): no body
  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });

  const head = request.method === "HEAD";
  if (object.range && request.headers.has("range")) {
    const r = object.range;
    let offset, length;
    if ("suffix" in r && r.suffix != null) { length = Math.min(r.suffix, object.size); offset = object.size - length; }
    else { offset = r.offset ?? 0; length = r.length ?? object.size - offset; }
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(head ? null : object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(head ? null : object.body, { status: 200, headers });
}

async function requireAdmin(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "Server is not configured." }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in required." }, 401);
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: auth };
  try {
    const u = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers, signal: AbortSignal.timeout(8000) });
    if (!u.ok) return json({ error: "Your session is invalid or expired. Sign in again." }, 401);
    const user = await u.json();
    const a = await fetch(env.SUPABASE_URL + "/rest/v1/admin_users?select=user_id&user_id=eq." + encodeURIComponent(user.id), { headers, signal: AbortSignal.timeout(8000) });
    if (!a.ok || !(await a.json()).length) return json({ error: "Administrator access required." }, 403);
    return null;
  } catch {
    return json({ error: "Could not verify your session. Try again." }, 502);
  }
}
