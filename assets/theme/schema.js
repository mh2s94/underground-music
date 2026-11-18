/* UNDERGROUND theme schema — the single source of truth for what a theme configuration may
   contain. Pure functions, no DOM: loaded by the browser (assets/theme/runtime.js) and, from
   Tahap 2, imported by the Cloudflare middleware, so the browser, the edge and the database
   all accept exactly the same keys and value formats.

   A theme configuration is { theme: "<id>", tokens: { <key>: <value>, ... } }.
   Anything not described here is dropped. Values are never copied into CSS as written:
   colours are re-emitted from parsed numbers, fonts from the allow-list below, numbers are
   clamped. That is what makes admin-supplied tokens safe to inject into every page. */
(function (g) {
  "use strict";

  var DEFAULT_THEME = "neon-bento";
  var THEME_ID = /^[a-z0-9-]{2,40}$/;

  // Font allow-list: key -> { stack, google } (google = family spec for fonts.googleapis.com, or "").
  var FONTS = {
    "bebas-neue":     { stack: '"Bebas Neue", Impact, "Arial Narrow", sans-serif', google: "Bebas+Neue" },
    "inter":          { stack: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif', google: "Inter:wght@400;500;600;700" },
    "space-mono":     { stack: '"Space Mono", ui-monospace, Menlo, monospace', google: "Space+Mono:wght@400;700" },
    "fraunces":       { stack: '"Fraunces", Georgia, serif', google: "Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,400" },
    "archivo-black":  { stack: '"Archivo Black", "Arial Black", sans-serif', google: "Archivo+Black" },
    "inter-tight":    { stack: '"Inter Tight", "Inter", system-ui, sans-serif', google: "Inter+Tight:wght@500;700;800" },
    "big-shoulders":  { stack: '"Big Shoulders Stencil Display", Impact, sans-serif', google: "Big+Shoulders+Stencil+Display:wght@800" },
    "special-elite":  { stack: '"Special Elite", "Courier New", monospace', google: "Special+Elite" },
    "system":         { stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', google: "" },
    "serif":          { stack: 'Georgia, "Times New Roman", serif', google: "" },
    "mono":           { stack: 'ui-monospace, Menlo, Consolas, monospace', google: "" }
  };

  // Token key -> how it is validated and which CSS custom properties it writes.
  // type "color": "#RRGGBB" (also writes "<var>-rgb" when rgb is set)
  // type "font":  a key of FONTS
  // type "px":    number of pixels, clamped to [min, max]
  // type "num":   number, clamped to [min, max]
  // Numbers (px, num) are accepted as a JSON number or a numeric string with at most 6 integer
  // digits and 2 decimals, then clamped; they are never rounded. Strings are never trimmed.
  // These exact rules are repeated in supabase/themes.sql (ug_clean_theme_tokens); a parity test
  // runs both on the same inputs. Change both together.
  var TOKENS = {
    accent:      { type: "color", css: "--ug-accent", rgb: "--ug-accent-rgb", label: "Warna utama" },
    accentHi:    { type: "color", css: "--ug-accent-hi", label: "Warna utama (terang)" },
    accentTint:  { type: "color", css: "--ug-accent-tint", label: "Warna utama (pucat)" },
    onAccent:    { type: "color", css: "--ug-on-accent", label: "Teks di atas warna utama" },
    accent2:     { type: "color", css: "--ug-accent-2", rgb: "--ug-accent-2-rgb", label: "Warna aksen" },
    accent2Hi:   { type: "color", css: "--ug-accent-2-hi", rgb: "--ug-accent-2-hi-rgb", label: "Warna aksen (terang)" },
    accent2Tint: { type: "color", css: "--ug-accent-2-tint", label: "Warna aksen (pucat)" },
    void:        { type: "color", css: "--ug-void", rgb: "--ug-void-rgb", label: "Latar terdalam" },
    bg:          { type: "color", css: "--ug-bg", rgb: "--ug-bg-rgb", label: "Background" },
    shell:       { type: "color", css: "--ug-shell", label: "Latar bingkai" },
    surface:     { type: "color", css: "--ug-surface", rgb: "--ug-surface-rgb", label: "Permukaan kartu" },
    surface2:    { type: "color", css: "--ug-surface-2", label: "Permukaan 2" },
    surface3:    { type: "color", css: "--ug-surface-3", label: "Permukaan 3" },
    line:        { type: "color", css: "--ug-line", label: "Garis" },
    line2:       { type: "color", css: "--ug-line-2", label: "Garis tegas" },
    ink:         { type: "color", css: "--ug-ink", rgb: "--ug-ink-rgb", label: "Teks utama" },
    inkSoft:     { type: "color", css: "--ug-ink-soft", label: "Teks bacaan" },
    muted:       { type: "color", css: "--ug-muted", label: "Teks sekunder" },
    faint:       { type: "color", css: "--ug-faint", label: "Teks samar" },
    ok:          { type: "color", css: "--ug-ok", rgb: "--ug-ok-rgb", label: "Status sukses" },
    warn:        { type: "color", css: "--ug-warn", rgb: "--ug-warn-rgb", label: "Status peringatan" },
    fontDisplay: { type: "font", css: "--ug-font-display", label: "Font judul" },
    fontBody:    { type: "font", css: "--ug-font-body", label: "Font isi" },
    fontMono:    { type: "font", css: "--ug-font-mono", label: "Font label" },
    radius:      { type: "px", css: "--ug-radius", min: 0, max: 32, label: "Radius sudut" },
    scanlines:   { type: "num", css: "--ug-scanlines", min: 0, max: 1, label: "Scanline (0 = mati)" }
  };

  // Theme catalogue. status "ready" = its files exist and it may be applied; "planned" = shown
  // in the Theme Manager as coming later, never loaded. Layout code for a ready theme lives in
  // assets/themes/<id>/ (theme.css, optional shell.js); the default theme needs no extra files.
  var THEMES = [
    { id: "neon-bento",    no: "00", name: "Neon Bento",        status: "ready",   css: false, js: false, desc: "Default. Bento dashboard, rail ikon, neon pink + UV." },
    { id: "front-page",    no: "01", name: "Front Page",        status: "planned", css: true,  js: true,  desc: "Editorial broadsheet: masthead, menu seksi, lead story, The Wire." },
    { id: "the-pit",       no: "02", name: "The Pit",           status: "planned", css: true,  js: true,  desc: "Brutalist: menu teks layar penuh, indeks judul raksasa.", experimental: true },
    { id: "setlist",       no: "03", name: "Setlist",           status: "planned", css: true,  js: true,  desc: "Satu kolom dengan pil navigasi mengambang." },
    { id: "mosh-grid",     no: "04", name: "Mosh Grid",         status: "planned", css: true,  js: true,  desc: "Kolase asimetris dengan menu ringkas di pojok." },
    { id: "control-room",  no: "05", name: "Control Room 2.0",  status: "planned", css: true,  js: true,  desc: "Sidebar berlabel, konten tengah, panel player kanan." },
    { id: "main-stage",    no: "06", name: "Main Stage",        status: "planned", css: true,  js: true,  desc: "Immersive layar penuh per cerita.", experimental: true },
    { id: "xerox-zine",    no: "07", name: "Xerox Zine",        status: "planned", css: true,  js: true,  desc: "Zine DIY per edisi dengan tab binder." },
    { id: "index",         no: "08", name: "Index",             status: "planned", css: true,  js: true,  desc: "Swiss editorial: navbar bernomor, tabel indeks." },
    { id: "frequency",     no: "09", name: "Frequency",         status: "planned", css: true,  js: true,  desc: "Player-first: dock radio sebagai navigasi channel." },
    { id: "scene-atlas",   no: "10", name: "Scene Atlas",       status: "planned", css: true,  js: true,  desc: "Peta genre interaktif dengan panel baca.", experimental: true }
  ];
  var READY = THEMES.filter(function (t) { return t.status === "ready"; }).map(function (t) { return t.id; });

  // Default token values of "neon-bento" (the values at the top of assets/bento.css). The Theme
  // Manager starts from these; a test checks they match bento.css.
  var DEFAULTS = {
    accent: "#FF2E63", accentHi: "#FF5C86", accentTint: "#FFE3EC", onAccent: "#07060B",
    accent2: "#7B5CFF", accent2Hi: "#A48FFF", accent2Tint: "#E4DCFF",
    void: "#050409", bg: "#07060B", shell: "#0A0912", surface: "#0E0C16", surface2: "#15121F", surface3: "#1B1729",
    line: "#221C36", line2: "#2E2648", ink: "#F2EEFF", inkSoft: "#D6D0EC", muted: "#A9A3C2", faint: "#7D769E",
    ok: "#3DF5A7", warn: "#FFC23D",
    fontDisplay: "bebas-neue", fontBody: "inter", fontMono: "space-mono",
    radius: 16, scanlines: 1
  };

  var HEX = /^#([0-9a-fA-F]{6})$/;

  function parseHex(v) {
    if (typeof v !== "string") return null;
    var m = HEX.exec(v);
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(rgb) {
    return "#" + rgb.map(function (c) { return ("0" + c.toString(16)).slice(-2); }).join("").toUpperCase();
  }
  // A JSON number or numeric string: at most 6 integer digits and 2 decimals, nothing else.
  var NUM = /^-?\d{1,6}(\.\d{1,2})?$/;
  function num(v) {
    var str = typeof v === "number" ? (isFinite(v) ? String(v) : "") : (typeof v === "string" ? v : "");
    if (!NUM.test(str)) return null;
    var n = parseFloat(str);
    return n === 0 ? 0 : n;   // no negative zero
  }
  function round(n) { return Math.round(n * 1000) / 1000; }

  // WCAG 2 contrast ratio between two "#RRGGBB" colours (1 to 21), or null.
  function contrast(a, b) {
    var A = parseHex(a), B = parseHex(b);
    if (!A || !B) return null;
    var lum = function (c) {
      var s = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    };
    var l1 = lum(A), l2 = lum(B);
    return round((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
  }

  // Validate a tokens object. Returns { tokens, css, rejected }:
  //   tokens   — clean values, safe to store (same keys, normalised)
  //   css      — { "--ug-x": "value" } ready to set as custom properties
  //   rejected — keys that were dropped (unknown key or bad value)
  function sanitizeTokens(input) {
    var out = { tokens: {}, css: {}, rejected: [] };
    if (!input || typeof input !== "object" || Array.isArray(input)) return out;
    Object.keys(input).forEach(function (key) {
      var spec = Object.prototype.hasOwnProperty.call(TOKENS, key) ? TOKENS[key] : null;
      var v = input[key];
      if (!spec) { out.rejected.push(key); return; }
      if (spec.type === "color") {
        var rgb = parseHex(v);
        if (!rgb) { out.rejected.push(key); return; }
        var hex = toHex(rgb);
        out.tokens[key] = hex;
        out.css[spec.css] = hex;
        if (spec.rgb) out.css[spec.rgb] = rgb.join(" ");
      } else if (spec.type === "font") {
        if (typeof v !== "string" || !Object.prototype.hasOwnProperty.call(FONTS, v)) { out.rejected.push(key); return; }
        out.tokens[key] = v;
        out.css[spec.css] = FONTS[v].stack;
      } else if (spec.type === "px" || spec.type === "num") {
        var n = num(v);
        if (n === null) { out.rejected.push(key); return; }
        n = Math.min(spec.max, Math.max(spec.min, n));
        if (n === 0) n = 0;
        out.tokens[key] = n;
        out.css[spec.css] = spec.type === "px" ? n + "px" : String(n);
      }
    });
    return out;
  }

  // Validate a whole configuration { theme, tokens }. A malformed id, or one that is not a
  // "ready" theme, falls back to the default theme (pass `known` to use another list).
  function sanitizeConfig(input, known) {
    var cfg = input && typeof input === "object" ? input : {};
    var id = typeof cfg.theme === "string" && THEME_ID.test(cfg.theme) ? cfg.theme : DEFAULT_THEME;
    if ((known || READY).indexOf(id) === -1) id = DEFAULT_THEME;
    var t = sanitizeTokens(cfg.tokens);
    return { theme: id, tokens: t.tokens, css: t.css, rejected: t.rejected };
  }

  // The CSS text for a set of validated custom properties, e.g. for a <style> block.
  // Only ever called with the output of sanitizeTokens(), so every value is already safe.
  function cssText(css, selector) {
    var body = Object.keys(css).filter(function (k) { return /^--ug-[a-z0-9-]+$/.test(k); })
      .map(function (k) { return k + ":" + css[k]; }).join(";");
    return body ? (selector || ":root") + "{" + body + "}" : "";
  }

  // Google Fonts stylesheet URL for the non-default fonts a token set uses, or "".
  function fontHref(tokens) {
    var fams = [];
    ["fontDisplay", "fontBody", "fontMono"].forEach(function (k) {
      var f = tokens && FONTS[tokens[k]];
      if (f && f.google && fams.indexOf(f.google) === -1) fams.push(f.google);
    });
    return fams.length ? "https://fonts.googleapis.com/css2?" + fams.map(function (f) { return "family=" + f; }).join("&") + "&display=swap" : "";
  }

  // Nothing in the schema may be changed at runtime by other scripts.
  function deepFreeze(o) { Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === "object") deepFreeze(o[k]); }); return Object.freeze(o); }
  [THEMES, READY, FONTS, TOKENS, DEFAULTS].forEach(deepFreeze);

  g.UGThemeSchema = Object.freeze({
    DEFAULT_THEME: DEFAULT_THEME,
    THEME_ID: THEME_ID,
    THEMES: THEMES,
    READY: READY,
    FONTS: FONTS,
    TOKENS: TOKENS,
    DEFAULTS: DEFAULTS,
    parseHex: parseHex,
    contrast: contrast,
    sanitizeTokens: sanitizeTokens,
    sanitizeConfig: sanitizeConfig,
    cssText: cssText,
    fontHref: fontHref
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
