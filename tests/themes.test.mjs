// Static checks for the single supported theme and its runtime assets.
import assert from "assert";
import fs from "fs";

const R = new URL("../", import.meta.url).pathname;
await import(R + "assets/theme/schema.js");
const S = globalThis.UGThemeSchema;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ""); }
function blocks(css) {
  const out = []; let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i); if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) }); i = j;
  }
  return out;
}
function selectors(css, id) {
  const bad = [];
  for (const b of blocks(css)) {
    if (/^@(media|supports)/.test(b.prelude)) { bad.push(...selectors(b.body, id)); continue; }
    if (/^@keyframes/.test(b.prelude)) continue;
    if (b.prelude.startsWith("@")) { bad.push("unexpected at-rule: " + b.prelude); continue; }
    for (const sel of b.prelude.split(",").map((s) => s.trim()).filter(Boolean))
      if (!sel.startsWith(`html[data-theme="${id}"]`)) bad.push(sel);
  }
  return bad;
}

t("catalogue: exactly one permanent Monochrome Modular theme", () => {
  assert.strictEqual(S.DEFAULT_THEME, "monochrome-modular");
  assert.deepStrictEqual(S.THEMES.map((x) => x.id), ["monochrome-modular"]);
  assert.deepStrictEqual([...S.READY], ["monochrome-modular"]);
  assert.strictEqual(S.THEMES[0].css, true);
  assert.strictEqual(S.THEMES[0].js, true);
});
t("schema rejects every legacy or unknown theme id and falls back to Monochrome Modular", () => {
  for (const id of ["neon-bento", "front-page", "the-pit", "setlist", "mosh-grid", "control-room", "main-stage", "xerox-zine", "index", "frequency", "scene-atlas", "unknown"])
    assert.strictEqual(S.sanitizeConfig({ theme: id, tokens: {} }).theme, S.DEFAULT_THEME, id);
  assert.strictEqual(S.sanitizeConfig({ theme: S.DEFAULT_THEME, tokens: {} }).theme, S.DEFAULT_THEME);
});
t("database theme allow-list contains only Monochrome Modular", () => {
  const sql = fs.readFileSync(R + "supabase/themes.sql", "utf8");
  assert.match(sql, /select p_id = 'monochrome-modular'/);
  assert.doesNotMatch(sql, /'neon-bento'|'front-page'|'the-pit'|'scene-atlas'/);
});
t("default token baseline is the Monochrome Modular design system", () => {
  assert.strictEqual(S.base(S.DEFAULT_THEME).bg, "#080808");
  assert.strictEqual(S.base(S.DEFAULT_THEME).accent, "#F4F4F4");
  assert.strictEqual(S.base(S.DEFAULT_THEME).radius, 8);
  assert.ok(S.contrast(S.DEFAULTS.ink, S.DEFAULTS.bg) >= 7);
});
t("only Monochrome Modular CSS and shell files remain", () => {
  const dirs = fs.readdirSync(R + "assets/themes").filter((x) => fs.statSync(R + "assets/themes/" + x).isDirectory());
  assert.deepStrictEqual(dirs, ["monochrome-modular"]);
  assert.ok(fs.existsSync(R + "assets/themes/monochrome-modular/theme.css"));
  assert.ok(fs.existsSync(R + "assets/themes/monochrome-modular/shell.js"));
});
t("theme CSS selectors are scoped to the sole theme", () => {
  const css = stripComments(fs.readFileSync(R + "assets/themes/monochrome-modular/theme.css", "utf8"));
  assert.deepStrictEqual(selectors(css, S.DEFAULT_THEME), []);
});
t("shell registers only Monochrome Modular and uses the approved site API", () => {
  const js = fs.readFileSync(R + "assets/themes/monochrome-modular/shell.js", "utf8");
  assert.ok(js.includes('var ID = "monochrome-modular";'));
  assert.ok(js.includes("registerShell(ID, mount)"));
  for (const bad of [/fetch\(/, /XMLHttpRequest/, /supabase/i, /localStorage|sessionStorage|document\.cookie/, /\beval\(|new Function/, /import\(/])
    assert.ok(!bad.test(js), String(bad));
});
t("schema.js is cache-busted with ASSET_REV, so a shipped theme change cannot be missed", () => {
  // The runtime reads ASSET_REV out of schema.js to version theme.css. If schema.js itself is cached
  // under a stale URL, a browser that has seen the site before keeps applying the previous theme:
  // that is how the old blurred mobile menu survived shipping. Tie the two together so bumping
  // ASSET_REV without updating these pages fails here.
  for (const page of ["index.html", "admin.html"]) {
    const html = fs.readFileSync(R + page, "utf8");
    assert.ok(
      html.includes("/assets/theme/schema.js?v=" + S.ASSET_REV),
      page + " must request schema.js with the current ASSET_REV (?v=" + S.ASSET_REV + ")"
    );
  }
});
t("branding references the PNG icon set and 1200x630 OG image", () => {
  const html = fs.readFileSync(R + "index.html", "utf8");
  const admin = fs.readFileSync(R + "admin.html", "utf8");
  const manifest = fs.readFileSync(R + "manifest.webmanifest", "utf8");
  for (const f of ["icon-192.png", "apple-touch-icon.png"]) { assert.ok(html.includes("/assets/" + f)); assert.ok(admin.includes("/assets/" + f)); }
  assert.ok(html.includes("/assets/og.png"));
  assert.ok(manifest.includes("/assets/icon-192.png") && manifest.includes("/assets/icon-512.png"));
});
console.log(`\n${n} single-theme tests passed`);
