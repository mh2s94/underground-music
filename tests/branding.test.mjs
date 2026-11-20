import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const pages = ["index.html", "admin.html", "privacy.html", "terms.html"];

for (const page of pages) {
  const html = read(page);
  assert.match(html, /assets\/icon-192\.png/, page + " must use the Glitch Wave PNG favicon");
  assert.doesNotMatch(html, /assets\/favicon\.svg/, page + " must not reference the legacy SVG favicon");
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
assert.equal(existsSync(new URL("../assets/favicon.svg", import.meta.url)), false, "legacy pink SVG favicon must be removed");

for (const page of ["index.html", "privacy.html", "terms.html"]) {
  const html = read(page);
  const marks = [...html.matchAll(/<svg class="glitch-wave-mark"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  for (const mark of marks) {
    assert.match(mark, /stroke="currentColor"/, page + " Glitch Wave must inherit currentColor");
    assert.doesNotMatch(mark, /<rect|<text|fill="#000|fill="black"/i, page + " mark must have no background tile or embedded text");
  }
}
console.log("Glitch Wave inline SVG branding checks passed.");
