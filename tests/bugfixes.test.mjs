// Regression tests for the bug fixes of 2026-11-19 · node tests/bugfixes.test.mjs
//   1 unsubscribe: GET never unsubscribes, POST does      2 newsletter: no double send on retry
//   3 broken % escapes don't crash routes                  4 reader shares add up to exactly 100
//   5 unknown band pages answer 404                        6 "*" inside a markdown link URL
//   7 newsletter: JSON body "null" is a 400, not a crash
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok", name); };

// Minimal stand-in for Cloudflare's HTMLRewriter: passes the response through unchanged.
globalThis.HTMLRewriter = class { on() { return this; } transform(res) { return res; } };
const realFetch = globalThis.fetch;
let calls = [];
const mockFetch = (handler) => { calls = []; globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); }; };
const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const env = { SUPABASE_URL: "https://sb.test", SUPABASE_ANON_KEY: "anon" };
const TOKEN = "123e4567-e89b-12d3-a456-426614174000";
const shellEnv = { ...env, ASSETS: { fetch: async () => new Response("<html><head><title>x</title></head><body></body></html>", { headers: { "content-type": "text/html" } }) } };

// ---- 1 unsubscribe --------------------------------------------------------
const U = await import("../functions/unsubscribe.js");
await ok("1 GET with a valid token shows a button and does not unsubscribe", async () => {
  mockFetch(() => { throw new Error("must not call Supabase"); });
  const res = await U.onRequestGet({ request: new Request(`https://x.test/unsubscribe?t=${TOKEN}`), env });
  const html = await res.text();
  assert.equal(calls.length, 0);
  assert.match(html, /<form method="post" action="\/unsubscribe\?t=123e4567-e89b-12d3-a456-426614174000"/);
});
await ok("1 GET with a broken token says the link is not valid", async () => {
  mockFetch(() => { throw new Error("must not call Supabase"); });
  const res = await U.onRequestGet({ request: new Request("https://x.test/unsubscribe?t=<script>"), env });
  const html = await res.text();
  assert.match(html, /Link not valid/);
  assert.ok(!html.includes("<script>"));
});
await ok("1 POST from the button unsubscribes and shows the escaped email with security headers", async () => {
  mockFetch(() => jsonRes("a<b>@x.test"));
  const res = await U.onRequestPost({ request: new Request(`https://x.test/unsubscribe?t=${TOKEN}`, { method: "POST", body: "" }), env });
  const html = await res.text();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpc\/ug_unsubscribe$/);
  assert.match(html, /a&lt;b&gt;@x\.test will no longer receive/);
  assert.ok(res.headers.get("content-security-policy"));
});
await ok("1 one-click POST from an email app answers plain text", async () => {
  mockFetch(() => jsonRes("a@x.test"));
  const res = await U.onRequestPost({ request: new Request(`https://x.test/unsubscribe?t=${TOKEN}`, { method: "POST", body: "List-Unsubscribe=One-Click" }), env });
  assert.equal(await res.text(), "Unsubscribed");
  assert.equal(calls.length, 1);
});

// ---- 2 + 7 newsletter -----------------------------------------------------
const NL = await import("../functions/api/newsletter/send.js");
const jwt = (claims) => "h." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".s";
const nlEnv = { ...env, RESEND_API_KEY: "re_test", NEWSLETTER_FROM: "U <n@x.test>" };
const nlFetch = (resend) => mockFetch((url, init) => {
  if (url.endsWith("/auth/v1/user")) return jsonRes({ id: "u1", email: "admin@x.test" });
  if (url.includes("/admin_users")) return jsonRes([{ user_id: "u1" }]);
  if (url.includes("/articles")) return jsonRes([{ id: 1, slug: "s", title: "T", content: "" }]);
  if (url.includes("/newsletter_subscribers")) return jsonRes(Array.from({ length: 150 }, (_, i) => ({ email: `p${i}@x.test`, token: TOKEN })));
  if (url.includes("api.resend.com")) return resend(init);
  throw new Error("unexpected " + url);
});
const nlReq = (body) => new Request("https://x.test/api/newsletter/send", {
  method: "POST", headers: { Authorization: "Bearer " + jwt({ aal: "aal2" }), "content-type": "application/json" }, body
});
await ok("7 JSON body null is a 400, not a crash", async () => {
  nlFetch(() => jsonRes({}));
  const res = await NL.onRequestPost({ request: nlReq("null"), env: nlEnv });
  assert.equal(res.status, 400);
});
await ok("2 a real send puts a stable Idempotency-Key on every batch", async () => {
  nlFetch(() => jsonRes({ data: [] }));
  const body = JSON.stringify({ subject: "S", intro: "I", article_ids: [1] });
  const r1 = await (await NL.onRequestPost({ request: nlReq(body), env: nlEnv })).json();
  const keys1 = calls.filter((c) => c.url.includes("resend")).map((c) => c.init.headers["Idempotency-Key"]);
  assert.equal(r1.sent, 150);
  assert.equal(keys1.length, 2);
  assert.ok(keys1.every((k) => /^ug-nl-[0-9a-f]{64}$/.test(k)));
  assert.notEqual(keys1[0], keys1[1]);
  calls.length = 0;
  await NL.onRequestPost({ request: nlReq(body), env: nlEnv });
  const keys2 = calls.filter((c) => c.url.includes("resend")).map((c) => c.init.headers["Idempotency-Key"]);
  assert.deepEqual(keys2, keys1, "pressing Send again reuses the same keys, so Resend skips batches already sent");
});
await ok("2 a test send has no Idempotency-Key (tests can be repeated)", async () => {
  nlFetch(() => jsonRes({ data: [] }));
  await NL.onRequestPost({ request: nlReq(JSON.stringify({ subject: "S", article_ids: [1], test: true })), env: nlEnv });
  const r = calls.find((c) => c.url.includes("resend"));
  assert.equal(r.init.headers["Idempotency-Key"], undefined);
});
await ok("2 a changed newsletter gets a new key", async () => {
  const a = await NL.batchKey("S", "I", ["1"], ["a@x"]);
  assert.equal(a, await NL.batchKey("S", "I", ["1"], ["a@x"]));
  assert.notEqual(a, await NL.batchKey("S2", "I", ["1"], ["a@x"]));
  assert.notEqual(a, await NL.batchKey("S", "I", ["1"], ["b@x"]));
});

// ---- 3 broken % escapes ---------------------------------------------------
const A = await import("../functions/a/[slug].js");
const B = await import("../functions/band/[slug].js");
await ok("3 /a/%E0 answers instead of throwing", async () => {
  mockFetch(() => jsonRes([]));
  const res = await A.onRequestGet({ request: new Request("https://x.test/a/%E0"), env: shellEnv, params: { slug: "%E0" } });
  assert.equal(res.status, 404);
});
await ok("3 /band/abc% answers instead of throwing", async () => {
  mockFetch(() => { throw new Error("offline"); });
  const res = await B.onRequestGet({ request: new Request("https://x.test/band/abc%25"), env: shellEnv, params: { slug: "abc%" } });
  assert.equal(res.status, 200);
});
await ok("3 the browser router uses a safe decode", () => {
  const src = readFileSync(new URL("../assets/bento.js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf("function route()"), src.indexOf("window.addEventListener(\"hashchange\", route)"));
  assert.ok(!route.includes("decodeURIComponent("), "route() must not call decodeURIComponent directly");
  assert.match(src, /const safeDecode = \(s\) => \{ try \{ return decodeURIComponent\(s\); \} catch \{ return s; \} \};/);
});

// ---- 4 reader shares ------------------------------------------------------
const R = await import("../functions/api/readers.js");
const sum = (a) => a.reduce((s, c) => s + c.pct, 0);
await ok("4 shares that used to add up to 102 now add up to 100", () => {
  const out = R.roundShares([{ code: "ID", pct: 40.5 }, { code: "US", pct: 30.5 }, { code: "DE", pct: 28.5 }, { code: "JP", pct: 0.5 }]);
  assert.equal(sum(out), 100);
  assert.ok(out.every((c) => Number.isInteger(c.pct) && c.pct >= 1));
});
await ok("4 shares with a remainder keep an 'other' row", () => {
  const out = R.roundShares([{ code: "ID", pct: 60.2 }, { code: "US", pct: 20.2 }]);
  assert.deepEqual(out, [{ code: "ID", pct: 60 }, { code: "US", pct: 20 }, { code: "other", pct: 20 }]);
});
await ok("4 many random cases always add up to 100", () => {
  for (let k = 0; k < 2000; k++) {
    let left = 100; const top = [];
    for (let i = 0; i < 5; i++) { const p = Math.random() * left; top.push({ code: "C" + i, pct: p }); left -= p; }
    top.sort((a, b) => b.pct - a.pct);
    assert.equal(sum(R.roundShares(top)), 100);
  }
});

// ---- 5 article-backed band profile shell ---------------------------------
const band = (slug) => B.onRequestGet({ request: new Request("https://x.test/band/" + slug), env: shellEnv, params: { slug } });
await ok("5 a valid band slug serves its profile shell without external or database reads", async () => {
  mockFetch(() => { throw new Error("band route must not call external APIs or Supabase"); });
  const res = await band("local-band");
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
  assert.match(res.headers.get("content-type"), /text\/html/);
});
await ok("5 an empty band slug answers 404", async () => {
  const res = await B.onRequestGet({ request: new Request("https://x.test/band/"), env: shellEnv, params: { slug: "" } });
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

// ---- 6 markdown links ------------------------------------------------------
await ok("6 '*' inside a link address stays in the href", () => {
  const src = readFileSync(new URL("../assets/bento.js", import.meta.url), "utf8");
  const start = src.indexOf("  const inline = (s) => {");
  const end = src.indexOf("\n  };", start) + 5;
  const inline = new Function(src.slice(start, end) + "\nreturn inline;")();
  const out = inline("see [the *list*](https://a.test/*foo*/x) and *this*");
  assert.match(out, /href="https:\/\/a\.test\/\*foo\*\/x"/);
  assert.match(out, /<em>list<\/em>/);
  assert.match(out, /<em>this<\/em>/);
  assert.equal(inline("**bold** [x](https://a.test/p)"), '<strong>bold</strong> <a href="https://a.test/p" target="_blank" rel="noopener noreferrer nofollow">x</a>');
});

globalThis.fetch = realFetch;
console.log(`\n${n} bug-fix checks passed`);
