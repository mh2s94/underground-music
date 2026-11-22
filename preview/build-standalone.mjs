// Build a single self-contained copy of preview/zine.html.
//
// preview/zine.html links the repository's real assets with relative paths, which is what keeps it
// honest in the checkout — but those paths break the moment the file is moved somewhere else. This
// inlines the base stylesheets, the theme stylesheet and the hero photograph, and resolves the theme
// tokens at build time, so the result is one file that opens anywhere on its own.
//
//   node preview/build-standalone.mjs [output.html]
//
// Only the Google Fonts stylesheet stays remote (it is a URL, not a path); offline, the stacks fall
// back to Arial Black / Courier New, which the theme tokens already name.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.argv[2] || path.join(ROOT, "..", "Downloads", "underground-zine-preview.html");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

await import(path.join(ROOT, "assets/theme/schema.js"));
const S = globalThis.UGThemeSchema;
if (!S) throw new Error("assets/theme/schema.js did not register UGThemeSchema");

const tokens = S.sanitizeTokens(S.THEMES[0].tokens);
if (tokens.rejected.length) throw new Error("rejected token keys: " + tokens.rejected.join(", "));

const style = (rel, note) =>
  `<style data-from="${rel}">\n/* ${note} — inlined from ${rel} */\n${read(rel)}\n</style>`;

const fontHref = S.fontHref(tokens.tokens);

let html = read("preview/zine.html");

// 1. The Google Fonts stylesheet stays remote, so put it in the head before anything is inlined.
if (fontHref) {
  html = html.replace(
    /(<title>Theme preview — UNDERGROUND \(monochrome-modular\)<\/title>)/,
    `$1\n<link rel="stylesheet" href="${fontHref}" />`
  );
}

// 2. The base and theme stylesheets, in the order the cascade expects: bento, launch, account,
//    theme, then the preview harness style, then the token block that overrides bento's defaults.
const sheets = [
  ["assets/bento.css", "Base layout, components and the element defaults"],
  ["assets/launch.css", "Splash"],
  ["assets/account.css", "Account panel"],
  ["assets/themes/monochrome-modular/theme.css", "The theme itself"],
];
for (const [rel, note] of sheets) {
  const tag = html.match(new RegExp(`<link rel="stylesheet" href="\\.\\./${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" />`));
  if (!tag) throw new Error("stylesheet link not found for " + rel);
  html = html.replace(tag[0], style(rel, note));
}

// 3. The token block replaces the runtime lookup. It must land after every other stylesheet so the
//    :root custom properties win over the fallback values in bento.css.
const tokenBlock = `  <style data-from="theme tokens">\n  /* Theme tokens, computed from assets/theme/schema.js exactly as the runtime applies them. */\n  ${S.cssText(tokens.css, ":root")}\n  </style>`;
const tokenScript = html.match(/^[ \t]*<script>\s*\/\/ Apply the default theme[\s\S]*?<\/script>/m);
if (!tokenScript) throw new Error("token script block not found");
html = html.replace(tokenScript[0], "");
const schemaScript = html.match(/<script src="\.\.\/assets\/theme\/schema\.js"><\/script>\n/);
if (!schemaScript) throw new Error("schema.js script tag not found");
html = html.replace(schemaScript[0], "");

// 4. The hero photograph, as a data URI.
const jpg = fs.readFileSync(path.join(ROOT, "assets/media/hero-drummer.jpg")).toString("base64");
html = html.replace(
  '<img class="mm-hero-img" src="../assets/media/hero-drummer.jpg" alt="" decoding="async" />',
  `<img class="mm-hero-img" src="data:image/jpeg;base64,${jpg}" alt="" decoding="async" />`
);

// 5. Links that pointed at sibling pages in the checkout have nowhere to go in a single file; keep
//    them as inert anchors so the button styles are still visible.
html = html.replace(/(href|src)="\.\.\/[^"]*"/g, '$1="#"');

// 6. Append the token block last in the head.
html = html.replace("</head>", tokenBlock + "\n</head>");

// The source page's own header comment describes the relative-path build; in a standalone file that
// no longer applies, so swap it for one that matches what this actually is.
const oldHeader = html.match(/<!--\n  A local preview of the shipped theme[\s\S]*?-->\n/);
if (!oldHeader) throw new Error("leading comment block not found");
html = html.replace(oldHeader[0], `<!--
  Standalone preview of the shipped "monochrome-modular" theme.

  Every stylesheet and the cover photograph are inlined, and the theme's tokens were resolved at
  build time from assets/theme/schema.js through the same sanitizeTokens()/cssText() pair the runtime
  uses, so this one file carries the whole look. Only the Google Fonts stylesheet is still remote;
  with no network the tokens fall back to the Arial Black / Courier New stacks they already name.

  The masthead is the markup assets/themes/monochrome-modular/shell.js assembles at runtime, written
  out by hand. The reader is normally a fixed overlay and is laid out inline here. Nothing in this
  file is part of the site — it is a preview harness.

  Generated by preview/build-standalone.mjs; edit preview/zine.html and rebuild rather than editing
  this copy.
-->
`);

const leftover = html.match(/(?:href|src)="\.\.\//g);
if (leftover) throw new Error("a relative path survived: " + leftover.slice(0, 3).join(", "));
if (/<link rel="stylesheet" href="\.\.\//.test(html)) throw new Error("an un-inlined stylesheet survived");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log("wrote " + OUT);
console.log("  " + Math.round(Buffer.byteLength(html) / 1024) + " KB, " + (html.match(/<style/g) || []).length + " inline stylesheets");
