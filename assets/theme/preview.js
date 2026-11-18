/* Admin theme preview (Tahap 3). Loaded by runtime.js only when the URL has ?ug-preview=<id>
   (kept for this tab in sessionStorage so the preview survives navigation and reloads).

   It shows a saved, NOT applied, theme configuration in this browser tab only:
   - it needs a signed-in admin whose session passed two-step verification (aal2);
   - it reads the draft from site_theme_configs, which RLS lets only such admins read;
   - it changes nothing on the server and nothing for any other visitor.
   For anyone else it quietly does nothing. */
(function () {
  "use strict";
  var me = document.currentScript;
  var id = me && me.getAttribute("data-ug-preview");
  var SUPABASE_URL = "https://lhhmzfwjznlwkentbakv.supabase.co";
  var SUPABASE_KEY = "sb_publishable_MQDqmSmPb3qiSODbBOSKmA_U7aBEFtN";
  if (!id || !window.UGTheme) return;

  function exit() {
    try { sessionStorage.removeItem("ug-preview"); } catch (e) {}
    var u = new URL(location.href);
    u.searchParams.delete("ug-preview");
    location.replace(u.toString());
  }

  function banner(kind, text) {
    var old = document.getElementById("ugPreviewBar");
    if (old) old.remove();
    var bar = document.createElement("div");
    bar.id = "ugPreviewBar";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483000;" +
      "display:flex;align-items:center;gap:10px;max-width:calc(100vw - 20px);padding:10px 12px 10px 14px;border-radius:14px;" +
      "font:600 12.5px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b0a10;box-shadow:0 10px 40px rgba(0,0,0,.5);" +
      (kind === "ok" ? "background:#FFC23D;" : "background:#F2EEFF;");
    var span = document.createElement("span");
    span.textContent = text;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Keluar preview";
    btn.style.cssText = "flex:none;border:0;border-radius:9px;padding:8px 10px;background:#0b0a10;color:#fff;font:700 12px system-ui,sans-serif;cursor:pointer";
    btn.onclick = exit;
    bar.appendChild(span);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function aal(token) {
    try {
      var b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      b += "===".slice((b.length + 3) % 4);
      return JSON.parse(atob(b)).aal || "";
    } catch (e) { return ""; }
  }

  function whenReady(fn, tries) {
    if (window.supabase && window.supabase.createClient && document.body) return fn();
    if ((tries || 0) > 100) return; // ~10 s: give up silently
    setTimeout(function () { whenReady(fn, (tries || 0) + 1); }, 100);
  }

  whenReady(async function () {
    var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    var session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) { session = null; }
    if (!session || aal(session.access_token) !== "aal2") return; // not an admin session: do nothing
    // Members never see anything: only an admin (own row readable in admin_users) gets feedback.
    var adm;
    try { adm = await sb.from("admin_users").select("user_id").eq("user_id", session.user.id).maybeSingle(); } catch (e) { adm = { data: null }; }
    if (!adm || !adm.data) return;

    var res;
    try {
      res = await sb.from("site_theme_configs").select("id,theme_id,name,tokens").eq("id", id).maybeSingle();
    } catch (e) { res = { error: e }; }
    if (res.error || !res.data) {
      banner("info", "Preview tidak tersedia: draf tidak ditemukan atau akun ini bukan admin.");
      return;
    }
    var cfg = res.data;
    var S = window.UGTheme.schema;
    var themeId = S.READY.indexOf(cfg.theme_id) > -1 ? cfg.theme_id : S.DEFAULT_THEME;

    // Show the draft exactly: drop the public theme's injected tokens first.
    var pub = document.getElementById("ug-theme-tokens");
    if (pub) pub.remove();
    var pubFonts = document.getElementById("ug-theme-fonts");
    if (pubFonts) pubFonts.remove();
    var used = await window.UGTheme.load(themeId, { version: "preview", tokens: cfg.tokens || {} });
    document.documentElement.setAttribute("data-theme-preview", "1");
    banner("ok", "PREVIEW, belum diterapkan: " + (cfg.name || "Tanpa nama") + " (" + used + "). Hanya terlihat di tab ini.");
  });
})();
