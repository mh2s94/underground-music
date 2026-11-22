// Contrast and control-boundary regression checks for the single supported theme.
//
// These lock in the accessibility fixes made during the editorial redesign of Monochrome Modular:
//   * every text/background pair in use stays at or above the WCAG AA ratio for its size band
//   * boundary-only controls (bordered buttons, inputs, the menu button, the chart switch) keep a
//     perceptible edge at or above 3:1 (WCAG 1.4.11), which the previous hairline colour did not
//   * the keyboard focus ring stays present and light enough to be seen against the page
// The values come from the theme schema (the single source of truth) and from theme.css, so a
// regression in either place fails here rather than silently shipping.
import assert from "assert";
import fs from "fs";

const R = new URL("../", import.meta.url).pathname;
await import(R + "assets/theme/schema.js");
const S = globalThis.UGThemeSchema;
const T = S.base(S.DEFAULT_THEME);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

// --- tiny CSS structure helpers (comments stripped, media bodies unwrapped) ---
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
function flatten(css) {
  const out = [];
  for (const b of blocks(css)) {
    if (/^@(media|supports)/.test(b.prelude)) { out.push(...flatten(b.body)); continue; }
    if (b.prelude.startsWith("@")) continue;                       // @keyframes / @font-face
    for (const sel of b.prelude.split(",").map((s) => s.trim()).filter(Boolean)) out.push({ sel, body: b.body });
  }
  return out;
}

const themeCss = stripComments(fs.readFileSync(R + "assets/themes/monochrome-modular/theme.css", "utf8"));
const rules = flatten(themeCss);

// --- text contrast (WCAG 1.4.3) ----------------------------------------------------------
// WCAG AA is 4.5:1 for normal text and 3:1 for large text. Everything here is either body copy
// or small uppercase labels, so the 4.5:1 floor applies to the lot.
t("every text/background pair clears 4.5:1", () => {
  const pairs = [
    ["ink on bg", T.ink, T.bg],
    ["ink on surface", T.ink, T.surface],
    ["ink on surface2", T.ink, T.surface2],
    ["inkSoft on bg", T.inkSoft, T.bg],
    ["inkSoft on surface", T.inkSoft, T.surface],
    ["muted on bg", T.muted, T.bg],
    ["muted on surface", T.muted, T.surface],
    ["accent on bg", T.accent, T.bg],
    ["onAccent on accent", T.onAccent, T.accent],
    ["bg on ink", T.bg, T.ink],
  ];
  for (const [what, fg, on] of pairs) {
    const r = S.contrast(fg, on);
    assert.ok(r !== null, what + ": unknown colour");
    assert.ok(r >= 4.5, what + " is " + r + ":1, needs 4.5:1");
  }
});

// Project standard, stricter than WCAG: sub-12px uppercase labels carry a wider margin
// (letter-spacing thins the strokes), so they must reach 5.5:1 rather than 4.5:1.
t("small uppercase labels (faint) clear the 5.5:1 house floor", () => {
  for (const [what, on] of [["bg", T.bg], ["surface", T.surface]]) {
    const r = S.contrast(T.faint, on);
    assert.ok(r >= 5.5, "faint on " + what + " is " + r + ":1, needs 5.5:1 for small labels");
  }
});

// --- boundary-only controls (WCAG 1.4.11) -----------------------------------------------
const edgeMatch = themeCss.match(/--mm-edge:\s*rgb\(var\(--ug-ink-rgb\)\s*\/\s*([0-9.]+)\)/);
t("theme defines an --mm-edge colour for control boundaries", () => {
  assert.ok(edgeMatch, "--mm-edge is not defined in theme.css");
  const a = Number(edgeMatch[1]);
  assert.ok(a > 0 && a <= 1, "--mm-edge alpha out of range: " + edgeMatch[1]);
});

t("--mm-edge reaches 3:1 over both the page and the card surface", () => {
  const a = Number(edgeMatch[1]);
  const ink = S.parseHex(T.ink);
  const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  for (const [what, base] of [["page", T.bg], ["card", T.surface]]) {
    const b = S.parseHex(base);
    const blended = hex(ink.map((c, i) => Math.round(a * c + (1 - a) * b[i])));
    const r = S.contrast(blended, base);
    assert.ok(r >= 3, "--mm-edge on " + what + " is " + r + ":1 (" + blended + "), needs 3:1");
  }
});

t("every boundary-only control is edged with --mm-edge", () => {
  const controls = [".btn-outline", ".btn-ghost-dark", ".icon-btn", ".input", ".chart-switch", ".mm-burger", ".mm-navwrap .nav"];
  for (const sel of controls) {
    assert.ok(
      rules.some((r) => r.sel.endsWith(sel) && r.body.includes("--mm-edge")),
      sel + " must take its boundary colour from --mm-edge"
    );
  }
});

// --- focus visibility (WCAG 2.4.7 / 1.4.11) ---------------------------------------------
t("a visible focus ring is declared and stays light against the page", () => {
  const base = fs.readFileSync(R + "assets/bento.css", "utf8");
  assert.match(base, /:focus-visible\s*\{[^}]*outline:\s*2px solid/, "no 2px focus outline in bento.css");
  const ring = S.contrast(T.accentHi, T.bg);
  assert.ok(ring >= 3, "focus ring (accentHi on bg) is " + ring + ":1, needs 3:1");
});

// --- motion ----------------------------------------------------------------------------
t("reduced-motion is honoured in the theme stylesheet", () => {
  assert.match(themeCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "no reduced-motion block");
});

console.log("\n" + n + " contrast tests passed");
