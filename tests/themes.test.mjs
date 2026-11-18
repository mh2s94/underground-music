// Static checks for the theme catalogue and every theme's files.
// Run: node tests/themes.test.mjs   (Node 20+, no packages, no network)
import assert from "assert";
import fs from "fs";
import crypto from "crypto";

const R = new URL("../", import.meta.url).pathname;
await import(R + "assets/theme/schema.js");
const S = globalThis.UGThemeSchema;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

// ---- helpers
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ""); }
// Split CSS into top-level blocks: [{ prelude, body }]
function blocks(css) {
  const out = []; let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i); if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}
function selectors(css, id, where = "") {
  const bad = [];
  for (const b of blocks(css)) {
    if (/^@(media|supports)/.test(b.prelude)) { bad.push(...selectors(b.body, id, b.prelude)); continue; }
    if (/^@keyframes/.test(b.prelude)) continue;
    if (b.prelude.startsWith("@")) { bad.push("unexpected at-rule: " + b.prelude); continue; }
    for (const sel of b.prelude.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!sel.startsWith(`html[data-theme="${id}"]`)) bad.push((where ? where + " " : "") + sel);
    }
  }
  return bad;
}
const themeFiles = () => S.THEMES.flatMap((th) => ["theme.css", "shell.js"].filter((f) => th[f === "theme.css" ? "css" : "js"]).map((f) => `assets/themes/${th.id}/${f}`)).sort();

// ---- catalogue
t("catalogue: 11 themes, unique ids and numbers 00–10, neon-bento is the default and needs no files", () => {
  assert.strictEqual(S.THEMES.length, 11);
  assert.strictEqual(new Set(S.THEMES.map((x) => x.id)).size, 11);
  assert.deepStrictEqual(S.THEMES.map((x) => x.no), ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  const nb = S.THEMES[0]; assert.strictEqual(nb.id, S.DEFAULT_THEME); assert.strictEqual(nb.css || nb.js, false); assert.deepStrictEqual({ ...nb.tokens }, {});
});
t("catalogue: every theme is ready and has its files", () => {
  for (const th of S.THEMES) {
    assert.strictEqual(th.status, "ready", th.id);
    if (th.css) assert.ok(fs.existsSync(R + `assets/themes/${th.id}/theme.css`), th.id + " theme.css");
    if (th.js) assert.ok(fs.existsSync(R + `assets/themes/${th.id}/shell.js`), th.id + " shell.js");
  }
  assert.deepStrictEqual([...S.READY], S.THEMES.map((x) => x.id));
});
t("database accepts exactly the catalogue ids (ug_theme_id_ok in supabase/themes.sql)", () => {
  const sql = fs.readFileSync(R + "supabase/themes.sql", "utf8");
  const ids = [...sql.match(/ug_theme_id_ok[\s\S]*?array\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids.sort(), S.THEMES.map((x) => x.id).sort());
});
t("Theme Manager has a layout sketch for every theme", () => {
  const js = fs.readFileSync(R + "assets/theme/manager.js", "utf8");
  for (const th of S.THEMES) assert.ok(js.includes(`"${th.id}": [`), th.id);
});

// ---- tokens
t("theme tokens: valid (nothing rejected) and only known keys", () => {
  for (const th of S.THEMES) {
    const r = S.sanitizeTokens(th.tokens);
    assert.deepStrictEqual(r.rejected, [], th.id);
    for (const k of Object.keys(th.tokens)) assert.ok(k in S.TOKENS, th.id + " " + k);
  }
});
t("theme tokens: readable contrast (WCAG) for text, cards and accent buttons", () => {
  for (const th of S.THEMES) {
    const b = S.base(th.id);
    const need = [["ink", "bg", 7], ["ink", "surface", 7], ["muted", "bg", 4.5], ["muted", "surface", 4.5], ["onAccent", "accent", 4.5], ["faint", "bg", 3]];
    for (const [a, c, min] of need) assert.ok(S.contrast(b[a], b[c]) >= min, `${th.id}: ${a}/${c} = ${S.contrast(b[a], b[c])} < ${min}`);
  }
});
t("S.base(id) = DEFAULTS + the theme's tokens, unknown id = DEFAULTS", () => {
  assert.deepStrictEqual(S.base("zz"), { ...S.DEFAULTS });
  assert.strictEqual(S.base("index").bg, "#FFFFFF");
  assert.strictEqual(S.base("index").radius, 0);
  assert.strictEqual(S.base("neon-bento").accent, S.DEFAULTS.accent);
});

// ---- files
t("theme.css: every selector is scoped to html[data-theme=\"<id>\"] (no leaks into other themes or pages)", () => {
  for (const th of S.THEMES.filter((x) => x.css)) {
    const css = stripComments(fs.readFileSync(R + `assets/themes/${th.id}/theme.css`, "utf8"));
    assert.deepStrictEqual(selectors(css, th.id), [], th.id);
  }
});
t("theme.css: no external resources, no imports, no expressions", () => {
  for (const th of S.THEMES.filter((x) => x.css)) {
    const css = fs.readFileSync(R + `assets/themes/${th.id}/theme.css`, "utf8");
    assert.ok(!/url\(\s*['"]?(https?:)?\/\//i.test(css), th.id + " external url()");
    assert.ok(!/@import|expression\(|javascript:/i.test(css), th.id + " import/expression");
  }
});
t("shell.js: registers its own id, uses only window.UG, no network, storage or eval", () => {
  for (const th of S.THEMES.filter((x) => x.js)) {
    const js = fs.readFileSync(R + `assets/themes/${th.id}/shell.js`, "utf8");
    assert.ok(js.includes(`var ID = "${th.id}";`) && js.includes("registerShell(ID, mount)"), th.id + " registers");
    for (const bad of [/fetch\(/, /XMLHttpRequest/, /supabase/i, /localStorage|sessionStorage|document\.cookie/, /\beval\(|new Function/, /import\(/]) assert.ok(!bad.test(js), th.id + " " + bad);
    assert.ok(/data-ug-shell/.test(js), th.id + " marks what it adds");
  }
});
t("performance budget: theme.css ≤ 20 KB and shell.js ≤ 6 KB each (loaded only for the active theme)", () => {
  for (const th of S.THEMES) {
    if (th.css) assert.ok(fs.statSync(R + `assets/themes/${th.id}/theme.css`).size <= 20000, th.id + " css");
    if (th.js) assert.ok(fs.statSync(R + `assets/themes/${th.id}/shell.js`).size <= 6000, th.id + " js");
  }
});
t("ASSET_REV changes whenever a theme file changes (browsers never keep an old theme file)", () => {
  const h = crypto.createHash("sha256");
  for (const f of themeFiles()) h.update(f + "\n" + fs.readFileSync(R + f, "utf8"));
  const want = "t-" + h.digest("hex").slice(0, 10);
  assert.strictEqual(S.ASSET_REV, want, `set ASSET_REV in assets/theme/schema.js to "${want}"`);
});

console.log(`\n${n} theme tests passed`);
