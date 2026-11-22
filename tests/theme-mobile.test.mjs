// Mobile-shell regression checks for the theme.
//
// bento.css carries phone-only rules that HIDE parts of the shell below 760px. A theme that wants to
// reveal those parts again has to declare the property itself: an inherited or undeclared value lets
// the hide win. That is precisely how the drawer once shipped with every label missing and only the
// icons left — bento.css said `@media (max-width: 760px) { .nav-tip { display: none } }` and the theme
// styled .nav-tip for position, opacity and colour, but never for display, so none was overridden.
//
// The checks below pin the mechanism rather than the pixels: who hides what, who beats it, and how.
import assert from "assert";
import fs from "fs";

const R = new URL("../", import.meta.url).pathname;
const read = (p) => fs.readFileSync(R + p, "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

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
// Every plain rule, with @media/@supports unwrapped so a phone-only rule is visible, and the
// enclosing query kept alongside it.
function rules(css, enclosing = []) {
  const out = [];
  for (const b of blocks(css)) {
    if (/^@(media|supports)/.test(b.prelude)) { out.push(...rules(b.body, [...enclosing, b.prelude])); continue; }
    if (b.prelude.startsWith("@")) continue;
    for (const sel of b.prelude.split(",").map((s) => s.trim()).filter(Boolean)) out.push({ sel, body: b.body, enclosing });
  }
  return out;
}
// [ids, classes+attributes+pseudo-classes, elements] — enough to tell whether one plain rule beats
// another when neither is !important.
function spec(sel) {
  const ids = (sel.match(/#[A-Za-z0-9_-]+/g) || []).length;
  const cls = (sel.match(/\.[A-Za-z0-9_-]+/g) || []).length
    + (sel.match(/\[[^\]]+\]/g) || []).length
    + (sel.match(/:(?!:)[a-z-]+/g) || []).length;
  const el = (sel.match(/(?:^|[\s>+~])[a-z][a-z0-9-]*/g) || []).length
    + (sel.match(/::[a-z-]+/g) || []).length;
  return [ids, cls, el];
}
const beats = (a, b) => { const x = spec(a), y = spec(b); return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2]; };

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

const bento = strip(read("assets/bento.css"));
const theme = strip(read("assets/themes/monochrome-modular/theme.css"));
const themeRules = rules(theme);

// --- the hide this theme has to beat -----------------------------------------------------
const phoneHides = rules(bento)
  .filter((r) => r.enclosing.some((q) => /max-width:\s*760px/.test(q)))
  .filter((r) => /display:\s*none/.test(r.body));

t("bento.css still hides the nav labels on phones — the condition this theme exists to beat", () => {
  const tip = phoneHides.find((r) => r.sel === ".nav-tip");
  assert.ok(tip, "bento.css no longer hides .nav-tip below 760px; the theme's extra display may be removable");
});

// --- the theme must re-show them, and win -------------------------------------------------
const tipRules = themeRules.filter((r) => r.sel.endsWith(".mm-navwrap .nav-tip"));

t("the theme declares a display for .mm-navwrap .nav-tip", () => {
  const withDisplay = tipRules.filter((r) => /(^|[\s;])display:/.test(r.body));
  assert.ok(withDisplay.length, "no display for .mm-navwrap .nav-tip: bento.css will hide every label on a phone");
  assert.doesNotMatch(withDisplay[withDisplay.length - 1].body, /display:\s*none/, ".mm-navwrap .nav-tip is display:none");
});

t("that display actually beats bento.css's .nav-tip rule", () => {
  const winner = tipRules.filter((r) => /(^|[\s;])display:/.test(r.body))[0];
  assert.ok(winner, "no display declared");
  assert.ok(rules(bento).some((r) => r.sel === ".nav-tip"), "bento.css defines .nav-tip");
  assert.ok(beats(winner.sel, ".nav-tip"), "selector " + winner.sel + " does not outrank .nav-tip; the hide would win");
});

// --- the drawer lays out the way the labels need -----------------------------------------
const drawer = themeRules.find((r) => r.sel.endsWith(".mm-navwrap .nav") && r.enclosing.some((q) => /max-width:\s*1080px/.test(q)));

t("the phone drawer stacks vertically and scrolls vertically, not sideways", () => {
  assert.ok(drawer, "no <=1080px rule for .mm-navwrap .nav");
  assert.match(drawer.body, /flex-direction:\s*column/, "the drawer must stack its rows");
  assert.match(drawer.body, /overflow-y:\s*auto/, "a long drawer must scroll vertically");
  assert.doesNotMatch(drawer.body, /overflow-x:\s*auto/, "overflow-x: auto would give the drawer a sideways scrollbar");
});

// --- the regression that started all of this ---------------------------------------------
t("the mobile scrim still never blurs", () => {
  const scrim = themeRules.find((r) => r.sel.endsWith(".mm-scrim"));
  assert.ok(scrim, "no .mm-scrim rule");
  assert.match(scrim.body, /backdrop-filter:\s*none/, "a scrim backdrop-filter blurs the whole phone screen when the menu opens");
});

console.log(`\n${n} mobile-shell tests passed`);
