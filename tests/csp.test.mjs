// Content-Security-Policy guard. Run: node tests/csp.test.mjs (Node 20+, no packages).
//
// script-src no longer uses 'unsafe-inline'. Every inline <script> and every inline event handler
// (on*=) must therefore be allowed by a SHA-256 hash. This test recomputes those hashes from the
// files themselves, so the moment someone edits an inline script — or adds a new one — the test
// fails instead of the browser silently blocking it in production.
import assert from "assert";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const R = new URL("../", import.meta.url).pathname;
const read = (p) => fs.readFileSync(R + p, "utf8");
const sha = (s) => "sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

// --- the two places the CSP lives; they must stay byte-identical (see docs/SECURITY.md) ----------
const cspFromHeaders = (read("_headers").match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1];
const E = await import(R + "functions/api/theme/edge.js");
const cspFromEdge = E.SECURITY_HEADERS["Content-Security-Policy"];

t("CSP is present in _headers and identical to edge.js SECURITY_HEADERS", () => {
  assert.ok(cspFromHeaders, "no Content-Security-Policy line in _headers");
  assert.strictEqual(cspFromHeaders, cspFromEdge);
});

const scriptSrc = (csp) => ((csp || "").match(/(?:^|;\s*)script-src ([^;]*)/) || [])[1] || "";
const rawSources = scriptSrc(cspFromHeaders).split(/\s+/).filter(Boolean);
// A hash source is only honoured when it is single-quoted ('sha256-…'); an unquoted hash is dropped
// by the browser as an invalid source. Keep the raw tokens for the keyword checks and also expose
// the bare form so the computed hashes below match.
const allowed = new Set(rawSources);
for (const s of rawSources) allowed.add(s.replace(/^'|'$/g, ""));

t("script-src does not fall back to 'unsafe-inline'", () => {
  assert.ok(!allowed.has("'unsafe-inline'"), "script-src must not contain 'unsafe-inline'");
  assert.ok(allowed.has("'self'"), "script-src must keep 'self' for the site's own files");
});

t("every hash source is single-quoted, as the browser requires", () => {
  for (const s of rawSources) {
    if (/^sha256-/.test(s)) assert.fail(`hash source must be quoted: '${s}' (an unquoted hash is ignored by the browser)`);
  }
  assert.ok(rawSources.some((s) => s.startsWith("'sha256-")), "expected at least one quoted hash source");
  for (const s of rawSources) {
    if (s.startsWith("'sha256-")) assert.ok(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(s), `malformed hash source: ${s}`);
  }
});

// --- every inline <script> in every HTML file must be hashed ------------------------------------
function htmlFiles(dir = R, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

t("every inline <script> is allowed by a hash", () => {
  const files = htmlFiles();
  assert.ok(files.length >= 4, "expected the site's HTML pages");
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (/\bsrc\s*=/i.test(m[1])) continue; // external: covered by 'self' / the host allow-list
      const hash = sha(m[2]);
      assert.ok(allowed.has(hash), `inline <script> in ${path.relative(R, file)} is not in script-src (${hash})`);
    }
  }
});

// --- every inline event handler (on*=) in HTML and in JS-built HTML must be hashed ---------------
function jsFilesUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFilesUnder(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const isDataBlock = (attrs) => {
  const m = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs);
  if (!m) return false;
  const type = m[1].trim().toLowerCase();
  return !(type === "module" || /^(text|application)\/(java|ecma)script$/.test(type));
};

t("every inline event handler is allowed by 'unsafe-hashes' + a hash", () => {
  assert.ok(allowed.has("'unsafe-hashes'"), "inline handlers need 'unsafe-hashes'");
  const files = [...jsFilesUnder(R + "assets"), ...jsFilesUnder(R + "functions"), ...htmlFiles()];
  const re = /\bon(?:click|error|load|change|input|submit|mouseover|focus|blur|keydown|keyup)\s*=\s*"([^"]*)"/gi;
  let seen = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    let m;
    while ((m = re.exec(text))) {
      seen++;
      const hash = sha(m[1]);
      assert.ok(allowed.has(hash), `inline handler "${m[1]}" in ${path.relative(R, file)} is not in script-src (${hash})`);
    }
  }
  assert.ok(seen > 0, "expected to find the site's inline onerror handlers");
});

// --- server-rendered pages may only add data-block scripts (JSON-LD), never classic inline code ---
t("functions/ emit only data-block inline scripts (no classic inline <script>)", () => {
  for (const file of jsFilesUnder(R + "functions")) {
    const text = fs.readFileSync(file, "utf8");
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(text))) {
      if (/\bsrc\s*=/i.test(m[1])) continue;
      assert.ok(isDataBlock(m[1]), `${path.relative(R, file)} emits a classic inline <script> (no hash can cover server-generated code)`);
    }
  }
});

console.log(`\n${n} CSP tests passed`);
