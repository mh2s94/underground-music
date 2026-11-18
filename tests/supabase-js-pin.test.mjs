// Checks that supabase-js is loaded at a fixed version with a correct Subresource Integrity hash.
// Run: node tests/supabase-js-pin.test.mjs   (Node 20+, needs network to cdn.jsdelivr.net)
import assert from "assert";
import fs from "fs";
import crypto from "crypto";

const R = new URL("../", import.meta.url).pathname;
const PAGES = ["index.html", "admin.html"];
const TAG = /<script\s+src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+)"([^>]*)><\/script>/g;

const found = [];
for (const page of PAGES) {
  const html = fs.readFileSync(R + page, "utf8");
  const tags = [...html.matchAll(TAG)];
  assert.strictEqual(tags.length, 1, `${page}: exactly one supabase-js tag`);
  const [, src, attrs] = tags[0];
  assert.match(src, /@\d+\.\d+\.\d+\/dist\/umd\/supabase\.min\.js$/, `${page}: exact version and file, got ${src}`);
  const integrity = (/integrity="(sha384-[A-Za-z0-9+/=]+)"/.exec(attrs) || [])[1];
  assert.ok(integrity, `${page}: integrity attribute`);
  assert.match(attrs, /crossorigin="anonymous"/, `${page}: crossorigin="anonymous" (required for SRI)`);
  found.push({ page, src, integrity });
}
assert.strictEqual(new Set(found.map((f) => f.src + f.integrity)).size, 1, "index.html and admin.html load the same file and hash");

const { src, integrity } = found[0];
const res = await fetch(src);
assert.strictEqual(res.status, 200, `download ${src}`);
const body = Buffer.from(await res.arrayBuffer());
const actual = "sha384-" + crypto.createHash("sha384").update(body).digest("base64");
assert.strictEqual(actual, integrity, "integrity hash matches the CDN file");
console.log(`supabase-js pin OK: ${src} (${body.length} bytes, ${integrity.slice(0, 20)}…)`);
