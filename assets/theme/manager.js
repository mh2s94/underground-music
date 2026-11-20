/* Theme Manager (admin → Settings → Appearance), Tahap 3.
   Runs inside admin.html after the admin session and two-step verification are confirmed.
   Uses only what supabase/themes.sql provides:
     read   : ug_active_theme(), site_theme_active / site_theme_configs / site_theme_history (RLS: admin + 2FA)
     write  : site_theme_configs (drafts, RLS), ug_apply_theme(), ug_restore_theme(), ug_reset_theme()
   then POST /api/theme/refresh so the edge shows the change within seconds (max. 60 s elsewhere).
   Every value is validated again by the database; this file only offers a convenient editor. */
(function () {
  "use strict";
  var A = window.UGAdmin, S = window.UGThemeSchema;
  if (!A || !S) return;
  var sb = A.sb, toast = A.toast, esc = A.esc;
  var $ = function (id) { return document.getElementById(id); };

  // Tokens the editor offers (the rest of a configuration is kept as loaded).
  var COLOURS = [["accent", "Warna utama"], ["accent2", "Warna aksen"], ["bg", "Background"], ["surface", "Permukaan kartu"], ["ink", "Teks utama"], ["muted", "Teks sekunder"]];
  var FONT_KEYS = [["fontDisplay", "Font judul"], ["fontBody", "Font isi"]];
  var FONT_LABEL = { "bebas-neue": "Bebas Neue", "inter": "Inter", "space-mono": "Space Mono", "fraunces": "Fraunces (serif)", "archivo-black": "Archivo Black", "inter-tight": "Inter Tight", "big-shoulders": "Big Shoulders Stencil", "special-elite": "Special Elite (mesin ketik)", "system": "System UI", "serif": "Serif sistem", "mono": "Mono sistem" };
  // Theme selection is intentionally fixed to the sole supported theme.
  var st = { loaded: false, busy: false, missing: false, active: null, activeRow: null, configs: [], history: [], themeId: S.DEFAULT_THEME, values: {}, extra: {}, configId: null, name: "", note: "" };

  function isMissing(err) {
    return !!err && (err.code === "42P01" || err.code === "PGRST202" || err.code === "PGRST205" || err.code === "42883" ||
      /does not exist|schema cache|could not find/i.test(err.message || ""));
  }
  function errText(err) {
    if (!err) return "";
    if (err.code === "42501" || /not allowed/i.test(err.message || "")) return "Butuh admin dengan verifikasi dua langkah. Muat ulang panel dan masukkan kode 6 digit.";
    return err.message || String(err);
  }
  function themeName() { return "Monochrome Modular"; }
  function fmt(ts) { try { return new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return ts || ""; } }
  // Every theme has its own token set (S.base: defaults + the theme's tokens); edits are made on top
  // of it and only what differs from it is stored.
  function full(tokens, themeId) { var v = S.base(themeId || S.DEFAULT_THEME); var c = S.sanitizeTokens(tokens || {}).tokens; Object.keys(c).forEach(function (k) { v[k] = c[k]; }); return v; }
  function diffTokens() {
    var out = {}, all = Object.assign({}, st.extra, st.values), b = S.base(st.themeId);
    Object.keys(all).forEach(function (k) { if (b[k] !== all[k]) out[k] = all[k]; });
    return S.sanitizeTokens(out).tokens;
  }

  /* ---------------- dialog ---------------- */
  function ask(title, body, okLabel, danger) {
    var d = $("tmDialog");
    if (!d || typeof d.showModal !== "function") return Promise.resolve(window.confirm(title + "\n\n" + body));
    $("tmDlgTitle").textContent = title;
    $("tmDlgBody").textContent = body;
    var ok = $("tmDlgOk");
    ok.textContent = okLabel || "Lanjutkan";
    ok.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    return new Promise(function (resolve) {
      d.onclose = function () { resolve(d.returnValue === "ok"); };
      d.returnValue = "";
      d.showModal();
    });
  }

  /* ---------------- data ---------------- */
  async function load() {
    if (!$("themeManager")) return;
    $("tmSetup").hidden = true;
    var r = await Promise.all([
      sb.rpc("ug_active_theme"),
      sb.from("site_theme_active").select("theme_id,version,applied_at,config_id").eq("id", 1).maybeSingle(),
      sb.from("site_theme_configs").select("id,theme_id,name,tokens,note,updated_at").eq("theme_id", S.DEFAULT_THEME).order("updated_at", { ascending: false }).limit(50),
      sb.from("site_theme_history").select("id,action,theme_id,tokens,version,applied_at,note").eq("theme_id", S.DEFAULT_THEME).order("version", { ascending: false }).limit(30)
    ]);
    st.missing = r.some(function (x) { return isMissing(x.error); });
    if (st.missing) {
      $("tmSetup").hidden = false;
      st.active = { theme: S.DEFAULT_THEME, tokens: {}, version: 0 };
      st.activeRow = null; st.configs = []; st.history = [];
    } else {
      var firstErr = r.map(function (x) { return x.error; }).find(Boolean);
      if (firstErr) toast("error", "Theme Manager", errText(firstErr));
      st.active = r[0].data || { theme: S.DEFAULT_THEME, tokens: {}, version: 0 };
      st.activeRow = r[1].data || null;
      st.configs = r[2].data || [];
      st.history = r[3].data || [];
    }
    if (!st.loaded) startFrom(st.active.theme, st.active.tokens, null, "", "");
    st.loaded = true;
    render();
  }

  function startFrom(themeId, tokens, configId, name, note) {
    st.themeId = S.DEFAULT_THEME;
    var f = full(tokens, st.themeId);
    st.values = {}; st.extra = {};
    Object.keys(f).forEach(function (k) {
      if (COLOURS.some(function (c) { return c[0] === k; }) || FONT_KEYS.some(function (c) { return c[0] === k; }) || k === "radius" || k === "scanlines") st.values[k] = f[k];
      else st.extra[k] = f[k];
    });
    st.configId = configId; st.name = name || ""; st.note = note || "";
  }

  /* ---------------- render ---------------- */
  function render() {
    renderStatus(); renderGrid(); renderEditor(); renderSample(); renderConfigs(); renderHistory();
    ["tmApply", "tmSave", "tmPrevDesk", "tmPrevHp", "tmReset"].forEach(function (id) { $(id).disabled = st.missing || st.busy; });
  }

  function renderStatus() {
    var a = st.active || { theme: S.DEFAULT_THEME, tokens: {}, version: 0 };
    var f = full(a.tokens, a.theme);
    $("tmStatus").innerHTML =
      '<span class="sw" aria-hidden="true"><i style="background:' + f.accent + '"></i><i style="background:' + f.accent2 + '"></i><i style="background:' + f.bg + '"></i><i style="background:' + f.surface + '"></i></span>' +
      "<div><span class=\"tm-live\">Aktif untuk semua pengunjung</span><b>" + esc(themeName(a.theme)) + "</b><small>" +
      (st.missing ? "Belum ada tabel tema: Monochrome Modular digunakan sebagai bawaan permanen." :
        "Versi " + esc(a.version) + (st.activeRow ? " · diterapkan " + esc(fmt(st.activeRow.applied_at)) : "") + " · " + Object.keys(a.tokens || {}).length + " pengaturan berbeda dari bawaan") +
      "</small></div>" +
      '<button class="btn btn-sm btn-ghost" type="button" id="tmReload">Muat ulang</button>';
    $("tmReload").onclick = function () { load(); };
  }

  function renderGrid() {
    var el = $("tmGrid");
    if (el) el.innerHTML = '<div class="tm-card" aria-current="true"><span class="nm">Monochrome Modular</span><span class="ds">Tema default permanen · satu-satunya tema yang tersedia</span><span class="tm-badges"><span class="tm-badge active">Aktif</span></span></div>';
  }

  function renderEditor() {
    $("tmTheme").textContent = themeName(st.themeId);
    $("tmName").value = st.name;
    $("tmNote").value = st.note;
    COLOURS.forEach(function (c) { $("tmc-" + c[0]).value = st.values[c[0]].toLowerCase(); $("tmt-" + c[0]).value = st.values[c[0]]; });
    FONT_KEYS.forEach(function (f) { $("tmf-" + f[0]).value = st.values[f[0]]; });
    $("tmRadius").value = st.values.radius; $("tmRadiusOut").value = st.values.radius + " px";
    $("tmScan").value = st.values.scanlines; $("tmScanOut").value = Math.round(st.values.scanlines * 100) + "%";
    $("tmEditing").textContent = st.configId ? "Mengedit draf tersimpan" : "Draf baru (belum disimpan)";
    contrast();
  }

  function contrast() {
    var rows = [["Teks utama / background", "ink", "bg", 7], ["Teks sekunder / background", "muted", "bg", 4.5], ["Teks utama / kartu", "ink", "surface", 7]];
    $("tmContrast").innerHTML = rows.map(function (r) {
      var c = S.contrast(st.values[r[1]], st.values[r[2]]) || 0;
      var good = c >= r[3];
      return '<div>' + esc(r[0]) + ': <span class="' + (good ? "ok" : "bad") + '">' + c.toFixed(1) + ":1" + (good ? " ✓" : " · terlalu rendah (min. " + r[3] + ":1)") + "</span></div>";
    }).join("");
  }

  function renderSample() {
    var v = st.values, s = $("tmSample");
    var font = function (k) { return (S.FONTS[v[k]] || S.FONTS[S.base(st.themeId)[k]]).stack; };
    s.style.background = v.bg; s.style.color = v.ink; s.style.borderRadius = v.radius + "px";
    s.innerHTML = '<span class="k" style="color:' + v.accent + '">● Latest drop</span>' +
      '<span class="t" style="font-family:' + esc(font("fontDisplay")) + ";color:" + v.ink + '">BENEATH THE <span style="color:' + v.accent2 + '">NOISE.</span></span>' +
      '<span style="font-family:' + esc(font("fontBody")) + ";color:" + v.muted + ';font-size:13.5px">Reviews, features and new releases from the heavier corners of the scene.</span>' +
      '<span class="row"><span class="pill" style="background:' + v.accent + ";color:" + (v.onAccent || S.DEFAULTS.onAccent) + ";border-radius:" + Math.min(v.radius, 14) + 'px">Read latest →</span>' +
      '<span class="pill" style="border:1.5px solid ' + v.accent2 + ";color:" + v.ink + ";border-radius:" + Math.min(v.radius, 14) + 'px">Explore genres</span></span>' +
      '<span class="card" style="background:' + v.surface + ";border-radius:" + v.radius + "px;color:" + v.ink + ";font-family:" + esc(font("fontBody")) + '">Kartu artikel · <span style="color:' + v.muted + '">2 jam lalu</span></span>';
  }

  function renderConfigs() {
    var el = $("tmConfigs");
    if (!st.configs.length) { el.innerHTML = '<li class="tm-empty">Belum ada draf tersimpan.</li>'; return; }
    el.innerHTML = st.configs.map(function (c) {
      return "<li><span class=\"v\">Draf</span><span><b>" + esc(c.name || "Tanpa nama") + "</b><small>" + esc(themeName(c.theme_id)) + " · " + esc(fmt(c.updated_at)) + (c.note ? " · " + esc(c.note) : "") + "</small></span>" +
        '<span class="act"><button class="btn btn-sm" type="button" data-cfg-load="' + esc(c.id) + '">Buka</button><button class="btn btn-sm btn-ghost" type="button" data-cfg-del="' + esc(c.id) + '">Hapus</button></span></li>';
    }).join("");
  }

  var ACTION = { apply: "Apply", restore: "Restore", reset: "Reset" };
  function renderHistory() {
    var el = $("tmHistory");
    if (!st.history.length) { el.innerHTML = '<li class="tm-empty">Belum ada riwayat. Riwayat muncul setelah Apply pertama.</li>'; return; }
    var activeV = st.active ? Number(st.active.version) : -1;
    el.innerHTML = st.history.map(function (h) {
      var current = Number(h.version) === activeV;
      return "<li><span class=\"v\">v" + esc(h.version) + "</span><span><b>" + esc(ACTION[h.action] || h.action) + " · " + esc(themeName(h.theme_id)) + "</b><small>" + esc(fmt(h.applied_at)) +
        " · " + Object.keys(h.tokens || {}).length + " pengaturan" + (h.note ? " · " + esc(h.note) : "") + "</small></span>" +
        '<span class="act">' + (current ? '<span class="tm-badge active">Aktif</span>' : '<button class="btn btn-sm" type="button" data-restore="' + esc(h.id) + '" data-version="' + esc(h.version) + '">Restore</button>') + "</span></li>";
    }).join("");
  }

  /* ---------------- actions ---------------- */
  async function saveDraft(silent) {
    var row = { theme_id: st.themeId, name: (st.name || "").slice(0, 80) || ("Tema " + new Date().toLocaleDateString("id-ID")), tokens: diffTokens(), note: (st.note || "").slice(0, 500) };
    var res = st.configId
      ? await sb.from("site_theme_configs").update(row).eq("id", st.configId).select("id").maybeSingle()
      : await sb.from("site_theme_configs").insert(row).select("id").maybeSingle();
    if (res.error || !res.data) { toast("error", "Draf tidak tersimpan", errText(res.error) || "Coba lagi."); return null; }
    st.configId = res.data.id; st.name = row.name;
    if (!silent) toast("success", "Draf tersimpan", "Belum diterapkan ke website.");
    var list = await sb.from("site_theme_configs").select("id,theme_id,name,tokens,note,updated_at").eq("theme_id", S.DEFAULT_THEME).order("updated_at", { ascending: false }).limit(50);
    if (!list.error) st.configs = list.data || [];
    render();
    return st.configId;
  }

  async function refreshEdge() {
    try {
      var s = (await sb.auth.getSession()).data.session;
      var r = await fetch("/api/theme/refresh", { method: "POST", headers: { Authorization: "Bearer " + (s ? s.access_token : "") } });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
      toast("success", "Tema diterapkan", "Berlaku untuk semua pengunjung dalam beberapa detik (paling lambat 60 detik).");
    } catch (e) {
      toast("warning", "Tema tersimpan", "Cache tidak bisa dibersihkan (" + (e.message || e) + "). Perubahan tetap berlaku paling lambat 60 detik.");
    }
  }

  async function run(label, fn) {
    if (st.busy) return;
    st.busy = true; render();
    try { await fn(); } catch (e) { toast("error", label, errText(e)); }
    st.busy = false;
    await load();
  }

  async function apply() {
    var tokens = diffTokens();
    var ok = await ask("Terapkan tema ke website?", themeName(st.themeId) + " dengan " + Object.keys(tokens).length + " pengaturan berbeda dari bawaan. Berlaku untuk SEMUA pengunjung music.mikasa.me dalam maksimal 60 detik. Versi sebelumnya tetap tersimpan di Riwayat.", "Terapkan");
    if (!ok) return;
    await run("Apply gagal", async function () {
      var id = await saveDraft(true);
      if (!id) return;
      var r = await sb.rpc("ug_apply_theme", { p_theme_id: st.themeId, p_tokens: tokens, p_config_id: id, p_note: (st.note || st.name || "").slice(0, 200) });
      if (r.error) throw r.error;
      await refreshEdge();
    });
  }

  async function restore(historyId, version) {
    var ok = await ask("Kembalikan versi " + version + "?", "Tema dan pengaturan dari versi " + version + " akan diterapkan lagi untuk semua pengunjung. Ini dicatat sebagai versi baru di Riwayat.", "Restore");
    if (!ok) return;
    await run("Restore gagal", async function () {
      var r = await sb.rpc("ug_restore_theme", { p_history_id: Number(historyId) });
      if (r.error) throw r.error;
      await refreshEdge();
    });
  }

  async function reset() {
    var ok = await ask("Kembalikan pengaturan Monochrome Modular ke nilai bawaan?", "Semua pengunjung akan melihat tampilan bawaan tanpa pengaturan tambahan. Versi saat ini tetap ada di Riwayat dan bisa di-Restore.", "Reset ke bawaan", true);
    if (!ok) return;
    await run("Reset gagal", async function () {
      var r = await sb.rpc("ug_reset_theme", { p_note: "Reset dari Theme Manager" });
      if (r.error) throw r.error;
      await refreshEdge();
    });
  }

  async function preview(phone) {
    // Open the window first (inside the click), so pop-up blockers allow it; point it at the draft once saved.
    var w = phone ? window.open("about:blank", "ugPreviewPhone", "width=390,height=844") : window.open("about:blank", "_blank");
    var id = await saveDraft(true);
    if (!id) { if (w) w.close(); return; }
    var url = "/?ug-preview=" + encodeURIComponent(id);
    if (w) { w.opener = null; w.location.href = url; } else location.href = url;
    toast("info", "Preview dibuka", "Hanya terlihat oleh kamu di tab itu. Website publik tidak berubah.");
  }

  /* ---------------- events ---------------- */
  function bind() {
    $("tmGrid").addEventListener("click", function (e) {
      var b = e.target.closest(".tm-card"); if (!b) return;
      if (b.getAttribute("aria-disabled") === "true") { toast("info", b.querySelector(".nm").textContent, "Tema ini dibangun pada tahap berikutnya dan belum bisa diterapkan."); return; }
      if (b.dataset.theme !== st.themeId) {
        startFrom(b.dataset.theme, {}, null, "", "");      // each theme starts from its own colours and fonts
        toast("info", b.querySelector(".nm").textContent, "Editor memakai warna dan font bawaan tema ini.");
      }
      render();
    });
    COLOURS.forEach(function (c) {
      $("tmc-" + c[0]).addEventListener("input", function (e) { st.values[c[0]] = e.target.value.toUpperCase(); $("tmt-" + c[0]).value = st.values[c[0]]; contrast(); renderSample(); });
      $("tmt-" + c[0]).addEventListener("change", function (e) {
        var v = String(e.target.value).trim().toUpperCase(); if (v && v[0] !== "#") v = "#" + v;
        if (/^#[0-9A-F]{6}$/.test(v)) { st.values[c[0]] = v; $("tmc-" + c[0]).value = v.toLowerCase(); contrast(); renderSample(); }
        else { e.target.value = st.values[c[0]]; toast("warning", "Format warna", "Gunakan format #RRGGBB, misalnya #FF2E63."); }
      });
    });
    FONT_KEYS.forEach(function (f) { $("tmf-" + f[0]).addEventListener("change", function (e) { st.values[f[0]] = e.target.value; renderSample(); }); });
    $("tmRadius").addEventListener("input", function (e) { st.values.radius = Number(e.target.value); $("tmRadiusOut").value = e.target.value + " px"; renderSample(); });
    $("tmScan").addEventListener("input", function (e) { st.values.scanlines = Number(e.target.value); $("tmScanOut").value = Math.round(e.target.value * 100) + "%"; });
    $("tmName").addEventListener("input", function (e) { st.name = e.target.value; });
    $("tmNote").addEventListener("input", function (e) { st.note = e.target.value; });
    $("tmSave").onclick = function () { saveDraft(false); };
    $("tmPrevDesk").onclick = function () { preview(false); };
    $("tmPrevHp").onclick = function () { preview(true); };
    $("tmApply").onclick = apply;
    $("tmReset").onclick = reset;
    $("tmDefaults").onclick = function () { startFrom(st.themeId, {}, st.configId, st.name, st.note); render(); };
    $("tmFromActive").onclick = function () { startFrom(st.active.theme, st.active.tokens, null, "", ""); render(); };
    $("tmConfigs").addEventListener("click", async function (e) {
      var l = e.target.closest("[data-cfg-load]"), d = e.target.closest("[data-cfg-del]");
      if (l) { var c = st.configs.find(function (x) { return x.id === l.dataset.cfgLoad; }); if (c) { startFrom(c.theme_id, c.tokens, c.id, c.name, c.note); render(); toast("info", "Draf dibuka", c.name || ""); } }
      if (d) {
        if (!(await ask("Hapus draf ini?", "Draf yang sudah pernah diterapkan tetap ada di Riwayat.", "Hapus", true))) return;
        var r = await sb.from("site_theme_configs").delete().eq("id", d.dataset.cfgDel);
        if (r.error) toast("error", "Gagal menghapus", errText(r.error));
        if (st.configId === d.dataset.cfgDel) st.configId = null;
        load();
      }
    });
    $("tmHistory").addEventListener("click", function (e) { var b = e.target.closest("[data-restore]"); if (b) restore(b.dataset.restore, b.dataset.version); });
  }

  function buildForm() {
    $("tmColours").innerHTML = COLOURS.map(function (c) {
      return '<label class="field"><span>' + esc(c[1]) + '</span><span class="tm-color"><input type="color" id="tmc-' + c[0] + '" aria-label="' + esc(c[1]) + '"><input class="input" id="tmt-' + c[0] + '" maxlength="7" spellcheck="false" aria-label="' + esc(c[1]) + ' (hex)"></span></label>';
    }).join("");
    $("tmFonts").innerHTML = FONT_KEYS.map(function (f) {
      return '<label class="field"><span>' + esc(f[1]) + '</span><select class="input" id="tmf-' + f[0] + '">' + Object.keys(S.FONTS).map(function (k) { return '<option value="' + esc(k) + '">' + esc(FONT_LABEL[k] || k) + "</option>"; }).join("") + "</select></label>";
    }).join("");
  }

  var started = false;
  // If the Settings tab is already open when this file loads (direct link to #settings), start now.
  setTimeout(function () {
    var panel = $("panel-settings"), app = $("app");
    if (panel && !panel.hidden && app && !app.hidden && window.UGThemeManager) window.UGThemeManager.load();
  }, 0);
  window.UGThemeManager = Object.freeze({
    load: function () {
      if (!$("themeManager")) return;
      if (!started) { started = true; buildForm(); bind(); }
      load();
    }
  });
})();
