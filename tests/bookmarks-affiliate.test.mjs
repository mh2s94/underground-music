// Stage 3 regression tests: local bookmarks + affiliate picks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const js = read("assets/bento.js");
const css = read("assets/bento.css");
const html = read("index.html");
const cfg = JSON.parse(read("data/affiliate-picks.json"));

assert.match(js, /const BOOKMARK_KEY = "ug_saved_articles_v1"/);
assert.match(js, /localStorage\.getItem\(BOOKMARK_KEY/);
assert.match(js, /localStorage\.setItem\(BOOKMARK_KEY, JSON\.stringify\(items\)\)/);
for (const field of ["slug", "title", "band", "genre", "cover_image_url", "saved_at"]) assert.ok(js.includes(field), "bookmark field " + field);
assert.match(js, /function savedArticlesHtml\(\)/);
assert.match(js, /data-bookmark-remove=/);
assert.match(js, /function updateSaveBtn\(pop\)/);
assert.match(js, /b\.querySelector\("span"\)\.textContent = on \? "Saved" : "Save"/);
assert.doesNotMatch(js, /from\("saved_articles"\)/, "Stage 3 bookmarks must not read or write the Supabase saved_articles table");
assert.match(js, /fetch\("\/data\/affiliate-picks\.json"/);
assert.match(js, /rel="noopener noreferrer sponsored"/);
assert.match(js, /target="_blank"/);
assert.match(js, /x\.active === true/);
assert.match(js, /if \(!active\.length\) return ""/);
assert.match(js, /active\.some\(\(x\) => x\.affiliate === true\)/);
assert.ok(cfg.items.every((item) => item.affiliate === false), "sample destinations must not claim affiliate commission");
assert.match(css, /\.affiliate-picks/);
assert.match(css, /\.affiliate-grid/);
assert.match(css, /@media \(max-width:700px\)/);
assert.match(html, /assets\/bento\.js\?v=[\w.-]+/);
assert.match(html, /assets\/bento\.css\?v=[\w.-]+/);
assert.equal(cfg.version, 1);
assert.ok(cfg.items.length >= 3 && cfg.items.length <= 4);
for (const item of cfg.items) {
  for (const field of ["id", "title", "subtitle", "badge", "price_label", "url", "image_url", "active"]) assert.ok(field in item, item.id + " missing " + field);
  assert.ok(["http:", "https:"].includes(new URL(item.url).protocol), item.id + " URL must be http(s)");
}
console.log("Stage 3 bookmarks and affiliate tests passed");
