// Edge theme reader + middleware tests. Run: node tests/theme-edge.test.mjs (Node 20+, no packages).
import assert from "assert";
import fs from "fs";
const R = new URL("../", import.meta.url).pathname;
// --- mock Cache API
class MemCache { constructor(){ this.m=new Map(); this.ops={match:0,put:0,delete:0}; } async match(req){ this.ops.match++; const e=this.m.get(req.url); if(!e) return undefined; if(Date.now()>e.exp){this.m.delete(req.url);return undefined;} return new Response(e.body,{headers:e.headers}); }
  async put(req,res){ this.ops.put++; const ttl=+(/max-age=(\d+)/.exec(res.headers.get("cache-control"))||[0,0])[1]; this.m.set(req.url,{body:await res.text(),headers:Object.fromEntries(res.headers),exp:Date.now()+ttl*1000}); }
  async delete(req){ this.ops.delete++; return this.m.delete(req.url); } }
globalThis.caches = { default: new MemCache() };
const E = await import(R + "functions/api/theme/edge.js");
const MW = await import(R + "functions/_middleware.js");
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("ok -", name); };
const reset = () => { globalThis.caches.default = new MemCache(); E._resetMemoryForTests(); };
let rpc = { status: 200, body: { theme: "monochrome-modular", tokens: {}, version: 1 }, delay: 0, calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes("/rest/v1/rpc/ug_active_theme")) {
    rpc.calls++; rpc.lastInit = init;
    if (rpc.delay) await new Promise((res, rej) => { const tm = setTimeout(res, rpc.delay); init.signal?.addEventListener("abort", () => { clearTimeout(tm); rej(new DOMException("aborted", "AbortError")); }); });
    if (rpc.throw) throw new Error("network");
    return new Response(typeof rpc.body === "string" ? rpc.body : JSON.stringify(rpc.body), { status: rpc.status, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected fetch " + url);
};
const INDEX = fs.readFileSync(R + "index.html", "utf8");
const page = (path, html = INDEX, extra = {}) => ({ path, html, ...extra });
async function mw(path, { html = INDEX, type = "text/html; charset=utf-8", status = 200, method = "GET", reqHeaders = {}, resHeaders = {} } = {}) {
  let seen;
  const ctx = { request: new Request("https://music.mikasa.me" + path, { method, headers: reqHeaders }), env: {}, waitUntil: (p) => p,
    next: async (req) => { seen = req || ctx.request; return new Response(method === "HEAD" ? null : html, { status, headers: { "content-type": type, etag: '"abc"', "content-length": "999", ...resHeaders } }); } };
  const res = await MW.onRequest(ctx);
  return { res, body: method === "HEAD" ? "" : await res.text(), seen };
}

await t("security headers identical to _headers /* block", () => {
  const block = fs.readFileSync(R + "_headers", "utf8").split(/\n(?=\S)/).find((b) => b.startsWith("/*"));
  const fromFile = Object.fromEntries(block.split("\n").slice(1).filter((l) => l.trim()).map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  assert.deepStrictEqual(fromFile, { ...E.SECURITY_HEADERS });
});
await t("default theme: html attrs set, no style block, headers on", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: {}, version: 7 }, calls: 0 };
  const { res, body } = await mw("/");
  assert.match(body, /<html lang="en" data-theme="monochrome-modular" data-theme-version="7">/);
  assert.ok(!body.includes("ug-theme-tokens"));
  assert.strictEqual(res.headers.get("x-frame-options"), "DENY");
  assert.ok(res.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  assert.ok(res.headers.get("strict-transport-security"));
  assert.strictEqual(res.headers.get("etag"), null); assert.strictEqual(res.headers.get("content-length"), null);
  assert.strictEqual(res.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@7;rpc");
});
await t("tokens injected as validated CSS before </head>", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: { accent: "#00ff88", radius: 8, fontDisplay: "fraunces" }, version: 9 }, calls: 0 };
  const { body } = await mw("/");
  const st = body.match(/<style id="ug-theme-tokens">([^<]*)<\/style>/)[1];
  for (const part of ["--ug-accent:#00FF88", "--ug-accent-rgb:0 255 136", '--ug-font-display:"Fraunces", Georgia, serif', "--ug-radius:8px"]) assert.ok(st.includes(part), part + " in " + st);
  assert.ok(st.startsWith(":root:root:root{") && st.endsWith("}"), "overrides outrank html[data-theme] rules");
  assert.ok(body.includes('id="ug-theme-fonts"') && body.includes("fonts.googleapis.com/css2?family=Fraunces"));
  assert.ok(body.indexOf("ug-theme-tokens") < body.indexOf("</head>") && body.indexOf("ug-theme-tokens") > body.indexOf("bento.css"));
});
await t("malicious RPC data is neutralised", async () => {
  reset(); rpc = { status: 200, body: { theme: 'monochrome-modular"><script>alert(1)</script>', tokens: { accent: "red;}</style><script>x()</script>", "--ug-accent": "#000000", bg: "#000000\"/>" }, version: "1; drop" }, calls: 0 };
  const { body, res } = await mw("/");
  assert.ok(!/alert\(1\)|x\(\)|<\/style><script/.test(body));
  assert.match(body, /data-theme="monochrome-modular" data-theme-version="0"/);
  assert.ok(!body.includes("ug-theme-tokens"));
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@0;fallback");
});
await t("legacy theme id falls back to the sole supported theme and its assets", async () => {
  reset(); rpc = { status: 200, body: { theme: "zz-theme", tokens: {}, version: 3 }, calls: 0 };
  const { body } = await mw("/"); assert.match(body, /data-theme="monochrome-modular"/); assert.ok(body.includes("/assets/themes/monochrome-modular/theme.css"));
});
for (const [name, setup] of [["RPC 404 (migration not applied)", () => ({ status: 404, body: { code: "PGRST202" } })], ["RPC 500", () => ({ status: 500, body: "x" })],
  ["network error", () => ({ status: 200, throw: true })], ["non-JSON body", () => ({ status: 200, body: "<html>oops" })], ["JSON array", () => ({ status: 200, body: [1, 2] })],
  ["null", () => ({ status: 200, body: "null" })], ["huge body", () => ({ status: 200, body: JSON.stringify({ theme: "monochrome-modular", pad: "x".repeat(30000) }) })]]) {
  await t("fallback: " + name, async () => { reset(); rpc = { ...setup(), calls: 0 }; const { res, body } = await mw("/");
    assert.match(body, /data-theme="monochrome-modular" data-theme-version="0"/); assert.strictEqual(res.status, 200); assert.ok(body.includes("</html>")); assert.ok(res.headers.get("content-security-policy")); });
}
await t("fallback: cold cache + timeout after 2000 ms → monochrome-modular, page still served", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: { accent: "#00ff88" }, version: 5 }, delay: 3000, calls: 0 };
  const t0 = Date.now(); const { body, res } = await mw("/"); const ms = Date.now() - t0;
  assert.ok(ms >= 1900 && ms < 2600, "took " + ms); assert.match(body, /data-theme-version="0"/); assert.match(res.headers.get("x-ug-theme"), /;fallback$/);
});
await t("cache: second request uses edge cache (1 RPC call)", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: { accent: "#00ff88" }, version: 4 }, calls: 0 };
  await mw("/"); const { res } = await mw("/privacy.html"); assert.strictEqual(rpc.calls, 1); assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@4;cache");
});
await t("cache: failures remembered briefly (no hammering)", async () => {
  reset(); rpc = { status: 404, body: {}, calls: 0 }; await mw("/"); await mw("/"); await mw("/terms.html"); assert.strictEqual(rpc.calls, 1);
});
await t("cache TTLs: 30 s ok, 15 s fail; purge works", async () => {
  assert.strictEqual(E.CACHE_TTL, 30); assert.strictEqual(E.CACHE_TTL_FAIL, 15);
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: {}, version: 1 }, calls: 0 };
  await mw("/"); rpc.body = { theme: "monochrome-modular", tokens: { accent: "#123456" }, version: 2 };
  assert.match((await mw("/")).body, /data-theme-version="1"/);
  assert.ok(await E.purgeActiveTheme("https://music.mikasa.me/api/theme/refresh"));
  assert.match((await mw("/")).body, /data-theme-version="2"/);
});
await t("cache is per host (preview never reads production)", () => {
  assert.notStrictEqual(E.cacheKey("https://music.mikasa.me/").url, E.cacheKey("https://theme-manager.underground-music.pages.dev/").url);
});
await t("conditional headers stripped so the browser never gets a stale 304", async () => {
  reset(); const { seen } = await mw("/", { reqHeaders: { "if-none-match": '"abc"', "if-modified-since": "Wed, 01 Jan 2025 00:00:00 GMT", "x-keep": "1" } });
  assert.strictEqual(seen.headers.get("if-none-match"), null); assert.strictEqual(seen.headers.get("if-modified-since"), null); assert.strictEqual(seen.headers.get("x-keep"), "1");
});
await t("admin.html: security headers, no theme", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: { accent: "#00ff88" }, version: 4 }, calls: 0 };
  const html = fs.readFileSync(R + "admin.html", "utf8");
  for (const p of ["/admin.html", "/admin"]) { const { res, body } = await mw(p, { html }); assert.strictEqual(body, html); assert.strictEqual(res.headers.get("x-frame-options"), "DENY"); assert.strictEqual(res.headers.get("x-ug-theme"), null); }
  assert.strictEqual(rpc.calls, 0);
});
await t("non-HTML and API responses untouched", async () => {
  reset(); rpc.calls = 0;
  for (const p of ["/api/news", "/sitemap.xml", "/assets/bento.css", "/docs/THEMES.md"]) { const { res, body } = await mw(p, { html: "{}", type: "application/json" }); assert.strictEqual(body, "{}"); assert.strictEqual(res.headers.get("etag"), '"abc"'); }
  const j = await mw("/a/x", { html: '{"a":1}', type: "application/json" }); assert.strictEqual(j.body, '{"a":1}');
  assert.strictEqual(rpc.calls, 0);
});
await t("SSR page (/a/…) themed, keeps no-store when asked", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: { accent: "#00ff88" }, version: 4 }, calls: 0 };
  const a = await mw("/a/some-story", { resHeaders: { "cache-control": "public, max-age=0, s-maxage=300" } });
  assert.match(a.body, /data-theme-version="4"/); assert.strictEqual(a.res.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const u = await mw("/unsubscribe", { html: "<!doctype html><html lang=en><head></head><body>x</body></html>", resHeaders: { "cache-control": "no-store" } });
  assert.strictEqual(u.res.headers.get("cache-control"), "no-store"); assert.match(u.body, /data-theme="monochrome-modular"/); assert.ok(u.res.headers.get("content-security-policy"));
});
await t("HEAD, 404 themed, 5xx and redirects headers only", async () => {
  reset(); rpc.calls = 0;
  const h = await mw("/", { method: "HEAD" }); assert.ok(h.res.headers.get("content-security-policy")); assert.strictEqual(rpc.calls, 0);
  const nf = await mw("/missing", { status: 404, html: "<html><head></head><body>404</body></html>" }); assert.match(nf.body, /data-theme="monochrome-modular"/); assert.strictEqual(nf.res.status, 404); assert.ok(nf.res.headers.get("x-frame-options"));
  const se = await mw("/x", { status: 500, html: "<html><head></head><body>e</body></html>" }); assert.ok(!se.body.includes("data-theme")); assert.ok(se.res.headers.get("content-security-policy"));
  const rd = await mw("/old", { status: 301, html: "" }); assert.ok(rd.res.headers.get("x-frame-options"));
  const post = await mw("/", { method: "POST" }); assert.strictEqual(post.res.headers.get("x-ug-theme"), null);
});
await t("existing data-theme attributes are replaced, not duplicated", () => {
  const out = E.injectTheme('<html lang="en" data-theme="x" data-theme-fallback=1 data-theme-version=\'9\'><head></head></html>', { theme: "monochrome-modular", tokens: {}, version: "3" });
  assert.strictEqual((out.match(/data-theme=/g) || []).length, 1); assert.ok(!out.includes("fallback")); assert.match(out, /data-theme-version="3"/);
});
await t("fragment without <html> left alone", () => { assert.strictEqual(E.injectTheme("<p>hi</p>", { theme: "monochrome-modular", tokens: { accent: "#000000" }, version: "1" }), "<p>hi</p>"); });
await t("RPC called with publishable key in apikey only (no Bearer for sb_ keys), POST, timeout signal", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: {}, version: 1 }, calls: 0 }; await mw("/");
  assert.strictEqual(rpc.lastInit.method, "POST"); assert.ok(rpc.lastInit.headers.apikey.startsWith("sb_publishable_")); assert.strictEqual(rpc.lastInit.headers.Authorization, undefined); assert.ok(rpc.lastInit.signal);
});
await t("isPageRequest / isThemedPath", () => {
  const u = (p) => new URL("https://x" + p);
  for (const p of ["/", "/privacy.html", "/terms", "/a/slug", "/band/x", "/unsubscribe", "/admin.html"]) assert.ok(E.isPageRequest(u(p), "GET"), p);
  for (const p of ["/api/news", "/assets/bento.js", "/sitemap.xml", "/robots.txt", "/README.md", "/__ug/theme-active"]) assert.ok(!E.isPageRequest(u(p), "GET"), p);
  assert.ok(!E.isThemedPath(u("/admin.html"))); assert.ok(!E.isThemedPath(u("/admin"))); assert.ok(E.isThemedPath(u("/administrator-news")));
});

// ---------------------------------------------------------------- resilience (last good theme)
const GOOD = { theme: "monochrome-modular", tokens: { accent: "#00FF88", radius: 12.5 }, version: 7 };
const expire = (path) => { const c = globalThis.caches.default; const k = "https://music.mikasa.me" + path; const e = c.m.get(k); if (e) e.exp = 0; };
const hdr = async (p = "/") => (await mw(p)).res.headers.get("x-ug-theme");
const accentOf = (body) => (/--ug-accent:(#[0-9A-F]{6})/.exec(body) || [])[1];

await t("timeout is 2000 ms; cache TTLs unchanged (30 s / 15 s); last good kept 7 days", () => {
  assert.strictEqual(E.RPC_TIMEOUT_MS, 2000); assert.strictEqual(E.CACHE_TTL, 30); assert.strictEqual(E.CACHE_TTL_FAIL, 15); assert.strictEqual(E.LAST_GOOD_TTL, 604800);
});
await t("cold cache: RPC read, stored as active (30 s) and as last good (7 days)", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 };
  const { body, res } = await mw("/");
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@7;rpc"); assert.strictEqual(accentOf(body), "#00FF88");
  const c = globalThis.caches.default;
  const lg = c.m.get("https://music.mikasa.me/__ug/theme-last-good"); assert.ok(lg); assert.deepStrictEqual(JSON.parse(lg.body), GOOD);
  assert.ok(lg.exp - Date.now() > 604000 * 1000);
  const act = c.m.get("https://music.mikasa.me/__ug/theme-active"); assert.ok(act.exp - Date.now() <= 30000);
});
await t("cache hit: no RPC call, source cache", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 };
  await mw("/"); const { res, body } = await mw("/terms"); assert.strictEqual(rpc.calls, 1);
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@7;cache"); assert.strictEqual(accentOf(body), "#00FF88");
});
await t("high-latency location: RPC answering in 1.5 s is used (was a fallback at 800 ms)", async () => {
  reset(); rpc = { status: 200, body: GOOD, delay: 1500, calls: 0 };
  const t0 = Date.now(); const h = await hdr(); assert.strictEqual(h, "monochrome-modular@7;rpc"); assert.ok(Date.now() - t0 >= 1450);
});
await t("RPC timeout after a good read → last good theme (stale), not monochrome-modular defaults", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/"); expire("/__ug/theme-active");
  rpc = { status: 200, body: { ...GOOD, version: 8 }, delay: 3000, calls: 0 };
  const t0 = Date.now(); const { res, body } = await mw("/"); const ms = Date.now() - t0;
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@7;stale"); assert.strictEqual(accentOf(body), "#00FF88"); assert.ok(ms < 2600, "took " + ms);
});
for (const [name, set] of [["HTTP 500", { status: 500, body: "x" }], ["HTTP 404 (function missing)", { status: 404, body: { code: "PGRST202" } }],
  ["network error", { status: 200, throw: true }], ["non-JSON", { status: 200, body: "<html>" }], ["unknown theme id", { status: 200, body: { theme: "evil", tokens: {}, version: 9 } }],
  ["one invalid token", { status: 200, body: { theme: "monochrome-modular", tokens: { accent: "#00FF88", bg: "red" }, version: 9 } }],
  ["version not an integer", { status: 200, body: { theme: "monochrome-modular", tokens: {}, version: "9; x" } }],
  ["injection attempt", { status: 200, body: { theme: 'monochrome-modular"><script>', tokens: { accent: "</style><script>" }, version: 9 } }]]) {
  await t("RPC error → last good: " + name, async () => {
    reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/"); expire("/__ug/theme-active");
    rpc = { ...set, calls: 0 };
    const { res, body } = await mw("/");
    assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@7;stale"); assert.strictEqual(accentOf(body), "#00FF88");
    assert.match(body, /<html lang="en" data-theme="monochrome-modular" data-theme-version="7">/);
    const st = /<style id="ug-theme-tokens">([^<]*)<\/style>/.exec(body)[1]; assert.ok(!/evil|red|script|style/.test(st), st);
    assert.ok(!body.includes("evil") && !body.includes("</style><script>"), "no bad value in the page");
    assert.deepStrictEqual(JSON.parse(globalThis.caches.default.m.get("https://music.mikasa.me/__ug/theme-last-good").body), GOOD, "invalid data never becomes last good");
  });
}
await t("failure is remembered 15 s and still serves last good (cache-stale), 1 RPC call", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/"); expire("/__ug/theme-active");
  rpc = { status: 500, body: "x", calls: 0 }; await mw("/");
  assert.strictEqual(await hdr("/privacy"), "monochrome-modular@7;cache-stale"); assert.strictEqual(rpc.calls, 1);
  const f = globalThis.caches.default.m.get("https://music.mikasa.me/__ug/theme-active"); assert.ok(f.exp - Date.now() <= 15000);
});
await t("no valid config ever read → monochrome-modular defaults (fallback / cache-fallback)", async () => {
  reset(); rpc = { status: 500, body: "x", calls: 0 };
  assert.strictEqual(await hdr(), "monochrome-modular@0;fallback"); assert.strictEqual(await hdr(), "monochrome-modular@0;cache-fallback");
});
await t("isolate restart (memory lost): last good comes from the edge cache", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/"); expire("/__ug/theme-active"); E._resetMemoryForTests();
  rpc = { status: 200, throw: true, calls: 0 }; assert.strictEqual(await hdr(), "monochrome-modular@7;stale");
});
await t("edge cache lost but same isolate: last good comes from memory", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/"); globalThis.caches.default = new MemCache();
  rpc = { status: 200, throw: true, calls: 0 }; assert.strictEqual(await hdr(), "monochrome-modular@7;stale");
});
await t("tampered last-good cache entry is validated again and ignored", async () => {
  reset(); const c = globalThis.caches.default;
  await c.put(E.lastGoodKey("https://music.mikasa.me/"), new Response(JSON.stringify({ theme: "monochrome-modular", tokens: { accent: "</style>" }, version: 3 }), { headers: { "cache-control": "max-age=999" } }));
  rpc = { status: 500, body: "x", calls: 0 }; const { body, res } = await mw("/");
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@0;fallback"); assert.ok(!body.includes("</style>\""));
  await c.put(E.cacheKey("https://music.mikasa.me/"), new Response(JSON.stringify({ ok: true, value: { theme: "x<y", tokens: {}, version: 1 } }), { headers: { "cache-control": "max-age=999" } }));
  assert.strictEqual(await hdr(), "monochrome-modular@0;cache-fallback");
});
await t("last good is per host (a preview never serves the production theme)", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/");
  rpc = { status: 500, body: "x", calls: 0 };
  const r = await E.readActiveTheme({}, "https://theme-edge.underground-music.pages.dev/", {});
  assert.strictEqual(r.source, "fallback"); assert.strictEqual(r.version, "0");
});
await t("Apply/Restore/Reset flow: refresh replaces last good; purge keeps it for outages", async () => {
  reset(); rpc = { status: 200, body: GOOD, calls: 0 }; await mw("/");
  const RESET = { theme: "monochrome-modular", tokens: {}, version: 8 };
  rpc = { status: 200, body: RESET, calls: 0 };
  assert.ok(await E.purgeActiveTheme("https://music.mikasa.me/api/theme/refresh"));
  const now = await E.readActiveTheme({}, "https://music.mikasa.me/api/theme/refresh", { bypassCache: true });
  assert.strictEqual(now.version, "8"); assert.strictEqual(now.source, "rpc");
  assert.deepStrictEqual(JSON.parse(globalThis.caches.default.m.get("https://music.mikasa.me/__ug/theme-last-good").body), RESET);
  await E.purgeActiveTheme("https://music.mikasa.me/"); rpc = { status: 500, body: "x", calls: 0 };
  const { body, res } = await mw("/"); assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@8;stale"); assert.ok(!body.includes("ug-theme-tokens"));
});
await t("only Monochrome Modular is injected with its CSS and shell", async () => {
  reset(); rpc = { status: 200, body: { theme: "monochrome-modular", tokens: {}, version: 12 }, calls: 0 };
  const { body, res } = await mw("/");
  const q = "?v=12." + globalThis.UGThemeSchema.ASSET_REV;
  assert.match(body, /data-theme="monochrome-modular" data-theme-version="12"/);
  assert.ok(body.includes('/assets/themes/monochrome-modular/theme.css' + q));
  assert.ok(body.includes('/assets/themes/monochrome-modular/shell.js' + q));
  assert.strictEqual(globalThis.UGThemeSchema.DEFAULTS.bg, "#080808");
  assert.strictEqual(globalThis.UGThemeSchema.DEFAULTS.accent, "#F4F4F4");
  assert.ok(!body.includes("ug-theme-tokens"), "empty saved overrides must not create an inline token block");
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@12;rpc");
});
await t("legacy theme ids are rejected and use the permanent default", async () => {
  reset(); rpc = { status: 200, body: { theme: "front-page", tokens: {}, version: 2 }, calls: 0 };
  const { body, res } = await mw("/");
  assert.match(body, /data-theme="monochrome-modular"/);
  assert.strictEqual(res.headers.get("x-ug-theme"), "monochrome-modular@0;fallback");
  assert.ok(!body.includes("/assets/themes/front-page/"));
});
console.log(`\\n${n} edge/middleware tests passed`);
globalThis.fetch = realFetch;
