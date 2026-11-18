/* UNDERGROUND theme runtime (browser). Loaded in <head> right after assets/theme/schema.js and
   before any stylesheet, so a theme is in place before the first paint.

   Responsibilities
   - Read the active theme from <html data-theme="…"> (set by the edge middleware from Tahap 2;
     absent today, which means the default theme "neon-bento").
   - Apply validated design tokens as custom properties on <html>.
   - Load a theme's own files (assets/themes/<id>/theme.css, shell.js) and fall back to the
     default theme if any of them fails or takes too long. The site must never end up blank.
   - Expose window.UGTheme for the theme files and, later, the admin preview.

   It never trusts input: theme ids and tokens always go through UGThemeSchema first. */
(function () {
  "use strict";
  var S = window.UGThemeSchema;
  var root = document.documentElement;
  if (!S) return; // schema missing: the default CSS still renders the site

  var LOAD_TIMEOUT_MS = 5000;
  var applied = [];          // custom properties set by setTokens(), so they can be cleared
  var state = { theme: S.DEFAULT_THEME, version: "0", fallback: "" };

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent("ug:" + name, { detail: detail })); } catch (e) { /* very old browser */ }
  }

  function meta(id) {
    for (var i = 0; i < S.THEMES.length; i++) if (S.THEMES[i].id === id) return S.THEMES[i];
    return null;
  }

  // Theme shells (assets/themes/<id>/shell.js) register a mount function here. A shell adds
  // theme-only parts (masthead, menus, map) built from window.UG only; everything it adds carries
  // data-ug-shell and is removed, together with its listeners (the cleanup it returns), as soon as
  // the theme changes, so switching themes never leaves anything behind.
  var shells = {};
  var mounted = null;        // { id, cleanup }
  function unmountShell() {
    if (mounted) {
      try { if (typeof mounted.cleanup === "function") mounted.cleanup(); } catch (e) { /* ignore */ }
      mounted = null;
    }
    var left = document.querySelectorAll("[data-ug-shell]");
    for (var i = 0; i < left.length; i++) left[i].parentNode.removeChild(left[i]);
    root.removeAttribute("data-ug-shell-mounted");
  }
  function mountShell(id) {
    if (mounted && mounted.id === id) return;
    unmountShell();
    var fn = shells[id];
    if (!fn || root.getAttribute("data-theme") !== id) return;
    var run = function () {
      if (root.getAttribute("data-theme") !== id || (mounted && mounted.id === id)) return;
      if (!document.querySelector(".app")) return;          // legal pages etc.: tokens and CSS only
      try {
        mounted = { id: id, cleanup: fn() };
        root.setAttribute("data-ug-shell-mounted", id);
      } catch (e) { mounted = { id: id, cleanup: null }; fallback("shell-error"); }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
  }
  function registerShell(id, fn) {
    if (!S.THEME_ID.test(String(id)) || typeof fn !== "function") return;
    shells[id] = fn;
    if (root.getAttribute("data-theme") === id) mountShell(id);
  }

  // Remove every trace of a non-default theme: files, attribute, injected tokens.
  function clearTheme() {
    unmountShell();
    var nodes = document.querySelectorAll("[data-ug-theme-asset]");
    for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
    clearTokens();
    root.setAttribute("data-theme", S.DEFAULT_THEME);
  }

  // Back to the default theme, recording why. Safe to call more than once.
  function fallback(reason) {
    clearTheme();
    state.theme = S.DEFAULT_THEME;
    state.fallback = String(reason || "error").slice(0, 40);
    root.setAttribute("data-theme-fallback", state.fallback);
    emit("theme-fallback", { reason: state.fallback });
  }

  function clearTokens() {
    applied.forEach(function (k) { root.style.removeProperty(k); });
    applied = [];
    var edge = document.getElementById("ug-theme-tokens");       // written into the HTML by the edge
    if (edge) edge.parentNode.removeChild(edge);
    var f = document.getElementById("ug-theme-fonts");
    if (f) f.parentNode.removeChild(f);
  }

  // Apply design tokens (validated here, whatever the caller passed). Returns what was rejected.
  function setTokens(tokens) {
    var t = S.sanitizeTokens(tokens);
    clearTokens();
    Object.keys(t.css).forEach(function (k) { root.style.setProperty(k, t.css[k]); applied.push(k); });
    var href = S.fontHref(t.tokens);
    if (href) {
      var l = document.createElement("link");
      l.id = "ug-theme-fonts"; l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
    }
    return t.rejected;
  }

  function addAsset(tag, attrs) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement(tag);
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      el.setAttribute("data-ug-theme-asset", "");
      el.onload = function () { resolve(el); };
      el.onerror = function () { reject(new Error(tag + " failed")); };
      document.head.appendChild(el);
    });
  }

  // Switch to a theme. Resolves with the theme actually in use (the default after a fallback).
  function load(id, opts) {
    opts = opts || {};
    var version = String(opts.version || "0").replace(/[^0-9a-zA-Z.-]/g, "").slice(0, 32) || "0";
    var m = S.THEME_ID.test(String(id)) ? meta(id) : null;
    if (!m || m.status !== "ready") { fallback("unknown-theme"); return Promise.resolve(S.DEFAULT_THEME); }

    clearTheme();
    root.removeAttribute("data-theme-fallback");
    state.fallback = "";
    if (opts.tokens || (m.tokens && Object.keys(m.tokens).length)) setTokens(Object.assign({}, m.tokens, opts.tokens));
    if (!m.css && !m.js) {           // the default theme needs no files
      root.setAttribute("data-theme", m.id);
      state.theme = m.id; state.version = version;
      emit("theme", { theme: m.id, version: version });
      return Promise.resolve(m.id);
    }

    var base = "/assets/themes/" + m.id + "/";
    var q = "?v=" + version + "." + S.ASSET_REV;
    var jobs = [];
    if (m.css) jobs.push(addAsset("link", { rel: "stylesheet", href: base + "theme.css" + q }));
    if (m.js) jobs.push(addAsset("script", { src: base + "shell.js" + q }));
    var timer;
    var timeout = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("timeout")); }, LOAD_TIMEOUT_MS); });
    return Promise.race([Promise.all(jobs), timeout]).then(function () {
      clearTimeout(timer);
      root.setAttribute("data-theme", m.id);
      state.theme = m.id; state.version = version;
      if (m.js) mountShell(m.id);
      emit("theme", { theme: m.id, version: version });
      return m.id;
    }, function (err) {
      clearTimeout(timer);
      fallback(err && err.message === "timeout" ? "timeout" : "asset-error");
      return S.DEFAULT_THEME;
    });
  }

  // Theme files injected into the HTML by the edge (Tahap 2) carry data-ug-theme-asset; if one
  // of them fails to load, drop the theme instead of leaving the page half-styled.
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute("data-ug-theme-asset")) fallback("asset-error");
  }, true);

  // Boot: accept the theme named in the HTML only if it is a ready theme.
  (function boot() {
    var id = root.getAttribute("data-theme");
    if (!id) { root.setAttribute("data-theme", S.DEFAULT_THEME); return; }
    var m = S.THEME_ID.test(id) ? meta(id) : null;
    if (!m || m.status !== "ready") { fallback("unknown-theme"); return; }
    state.theme = m.id;
    state.version = root.getAttribute("data-theme-version") || "0";
  })();

  // Admin preview (Tahap 3): ?ug-preview=<saved config id> loads assets/theme/preview.js, which shows
  // the draft in this tab only and only for an admin with two-step verification (the draft is
  // readable through RLS by such admins only). Visitors and the public theme are never affected.
  (function previewHook() {
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var id = null;
    try {
      id = new URLSearchParams(location.search).get("ug-preview");
      if (id && UUID.test(id)) sessionStorage.setItem("ug-preview", id);
      else id = sessionStorage.getItem("ug-preview");
    } catch (e) { id = null; }
    if (!id || !UUID.test(id)) return;
    var s = document.createElement("script");
    s.src = "/assets/theme/preview.js?v=t3";
    s.defer = true;
    s.setAttribute("data-ug-preview", id);
    document.head.appendChild(s);
  })();

  window.UGTheme = Object.freeze({
    schema: S,
    current: function () { return state.theme; },
    version: function () { return state.version; },
    lastFallback: function () { return state.fallback; },
    themes: function () { return S.THEMES; },
    load: load,
    registerShell: registerShell,
    setTokens: setTokens,
    clearTokens: clearTokens,
    fallback: fallback
  });
})();
