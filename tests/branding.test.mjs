import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const pages = ["index.html", "admin.html", "privacy.html", "terms.html"];

for (const page of pages) {
  const html = read(page);
  assert.match(html, /assets\\/favicon\\.svg\\?v=glitch-wave-2/, page + " must use the versioned Glitch Wave SVG favicon");
  assert.match(html, /type="image\\/svg\\+xml"/, page + " must declare the SVG favicon media type");
  assert.doesNotMatch(html, /stroke="#FF5C86"|stroke="#FFE3EC"/, page + " must not contain the old pink U mark");
}

const home = read("index.html");
for (const [selector, label] of [
  ['class="emblem"', "sidebar/header"],
  ['class="splash-inner"', "first-load splash"],
  ['class="profile-emblem"', "About profile"],
  ['class="ft-brand"', "footer"]
]) {
  const start = home.indexOf(selector);
  assert.notEqual(start, -1, label + " mark container must exist");
  const fragment = home.slice(start, start + 700);
  assert.match(fragment, /<svg class="glitch-wave-mark"[\s\S]*?stroke="currentColor"/, label + " must use inline currentColor Glitch Wave SVG");
}

const shell = read("assets/themes/monochrome-modular/shell.js");
assert.match(shell, /<svg class="mm-mark"[\s\S]*?stroke="currentColor"/, "Monochrome Modular top-bar mark must use inline currentColor SVG");

const launch = read("assets/launch.js");
assert.match(launch, /class="lm-logo"[\s\S]*?<svg class="glitch-wave-mark"[\s\S]*?stroke="currentColor"/, "animated launch overlay must use inline currentColor SVG");
assert.doesNotMatch(launch, /<img|<rect|<text/, "launch mark must be a pure vector without image tile or text");

const launchCss = read("assets/launch.css");
assert.match(launchCss, /#lm \.lm-logo svg/, "launch overlay vector must be styled");

const styles = read("assets/bento.css");
for (const selector of [".emblem svg", ".profile-emblem svg", ".splash-inner svg", ".ft-brand svg"]) {
  assert.ok(styles.includes(selector), "missing inline SVG styling: " + selector);
}
const favicon = read("assets/favicon.svg");
assert.match(favicon, /viewBox="0 0 64 40"/, "favicon must use the launch mark viewBox");
assert.match(favicon, /d="M2 20h7l5-11 7 22 7-17 6 10 7-16 7 24 6-12h10"/, "favicon must use the exact Glitch Wave path");
assert.match(favicon, /stroke="#fff"/i, "standalone favicon must render white on dark browser chrome");
assert.doesNotMatch(favicon, /<rect|<text|fill="#000|fill="black"/i, "favicon must have no square background or embedded text");

const launchMark = read("assets/launch.js").match(/<svg class="glitch-wave-mark"[\\s\\S]*?<\\/svg>/)?.[0] || "";
assert.ok(launchMark, "launch screen must contain the source Glitch Wave SVG");
const launchPath = launchMark.match(/<path d="([^"]+)"/)?.[1];
assert.equal(launchPath, favicon.match(/<path d="([^"]+)"/)?.[1], "favicon path must exactly match the launch wave");

const headers = read("_headers");
assert.match(headers, /\\/\\s*\\n\\s*Cache-Control: no-cache, must-revalidate/, "root document must revalidate");
assert.match(headers, /\\/\\*\\.html\\s*\\n\\s*Cache-Control: no-cache, must-revalidate/, "HTML documents must revalidate");
assert.match(headers, /\\/assets\\/favicon\\.svg\\s*\\n\\s*Cache-Control: public, max-age=300, must-revalidate/, "SVG favicon must have a short revalidation window");
assert.equal(existsSync(new URL("../sw.js", import.meta.url)) || existsSync(new URL("../service-worker.js", import.meta.url)), false, "this project does not currently ship a service worker to version-bump");

for (const page of ["index.html", "privacy.html", "terms.html"]) {
  const html = read(page);
  const marks = [...html.matchAll(/<svg class="glitch-wave-mark"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  for (const mark of marks) {
    assert.match(mark, /stroke="currentColor"/, page + " Glitch Wave must inherit currentColor");
    assert.doesNotMatch(mark, /<rect|<text|fill="#000|fill="black"/i, page + " mark must have no background tile or embedded text");
  }
}
console.log("Glitch Wave inline SVG branding checks passed.");
