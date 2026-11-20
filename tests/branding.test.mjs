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
assert.match(home, /class="emblem"[\s\S]*?src="\/assets\/icon-512\.png"/, "sidebar/header emblem must use Glitch Wave");
assert.match(home, /class="splash-inner"[\s\S]*?src="\/assets\/icon-512\.png"/, "first-load splash must use Glitch Wave");
assert.match(home, /class="profile-emblem"[\s\S]*?src="\/assets\/icon-512\.png"/, "About profile emblem must use Glitch Wave");
assert.match(home, /class="ft-brand"[\s\S]*?src="\/assets\/icon-512\.png"/, "footer brand must use Glitch Wave");

const shell = read("assets/themes/monochrome-modular/shell.js");
assert.match(shell, /class="mm-mark" src="\/assets\/icon-512\.png"/, "Monochrome Modular top-bar mark must use Glitch Wave");
assert.doesNotMatch(shell, /<svg class="mm-mark"/, "legacy geometric top-bar mark must be removed");

const launch = read("assets/launch.js");
assert.match(launch, /class="lm-logo"[\s\S]*?src="\/assets\/icon-512\.png"/, "animated launch overlay must use Glitch Wave");

const launchCss = read("assets/launch.css");
assert.match(launchCss, /#lm \.lm-logo img/, "launch overlay image must be styled");
assert.doesNotMatch(launchCss, /#lm\.m09 \.lm-logo svg/, "launch overlay must not hide the new logo");

const styles = read("assets/bento.css");
for (const selector of [".emblem img", ".profile-emblem img", ".splash-inner img", ".ft-brand img"]) {
  assert.ok(styles.includes(selector), "missing image styling: " + selector);
}
assert.equal(existsSync(new URL("../assets/favicon.svg", import.meta.url)), false, "legacy pink SVG favicon must be removed");

console.log("Glitch Wave branding checks passed.");
