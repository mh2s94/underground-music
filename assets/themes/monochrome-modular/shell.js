// 11 · Monochrome Modular — top bar with the modular mark and a "Basement signal" light that follows
// the player, a vertical caption on the icon rail, the newest story cover as a grayscale hero photo,
// and the ticker + hero lifted above both dashboard columns (put back on cleanup).
(function () {
  "use strict";
  var ID = "monochrome-modular";
  var MARK = '<svg class="mm-mark" width="38" height="24" viewBox="0 0 64 40" fill="none" role="img" aria-hidden="true" focusable="false"><path d="M2 20h7l5-11 7 22 7-17 6 10 7-16 7 24 6-12h10" stroke="currentColor" stroke-width="3.2" stroke-linecap="square" stroke-linejoin="miter"/></svg>';

  function mount() {
    var undo = [];
    function on(t, e, f) { t.addEventListener(e, f); undo.push(function () { t.removeEventListener(e, f); }); }
    function mark(el) { el.setAttribute("data-ug-shell", ""); return el; }
    var main = document.getElementById("main");
    var side = document.querySelector(".sidebar");
    var home = document.querySelector("#view-home .home");
    var hero = document.querySelector("#view-home .hero");
    var ticker = document.querySelector("#view-home .ticker");

    var top = mark(document.createElement("header"));
    top.className = "mm-top";
    top.innerHTML = '<a class="mm-brand" href="#/" aria-label="UNDERGROUND home">' + MARK +
      '<span><span class="mm-name">UNDERGROUND</span><span class="mm-tag">MUSIC / CULTURE / SCENE</span></span></a>' +
      '<div class="mm-right"><span class="mm-sig" role="status"><i aria-hidden="true"></i><span>Basement signal</span></span>' +
      '<span class="mm-pub">Independent extreme music magazine</span></div>';
    if (main) main.insertBefore(top, main.firstChild);

    if (side) {
      var vert = mark(document.createElement("div"));
      vert.className = "mm-vert"; vert.setAttribute("aria-hidden", "true"); vert.textContent = "INDEPENDENT MUSIC CULTURE";
      side.insertBefore(vert, side.querySelector(".sidebar-foot"));
    }

    // Lift ticker + hero above both columns; remember where they were
    var lead = null, spots = [];
    if (home && hero) {
      lead = mark(document.createElement("div"));
      lead.className = "mm-lead";
      [ticker, hero].forEach(function (el) {
        if (!el) return;
        spots.push({ el: el, parent: el.parentNode, next: el.nextSibling });
        lead.appendChild(el);
      });
      home.parentNode.insertBefore(lead, home);
      undo.push(function () {
        for (var i = spots.length - 1; i >= 0; i--) { var s = spots[i]; s.parent.insertBefore(s.el, s.next); }
      });
    }

    var img = null;
    function photo() {
      var UG = window.UG; if (!hero || !UG) return;
      var a = (UG.articles || []).filter(function (x) { return /^https:\/\//.test(x.cover || ""); })[0];
      if (!a) { if (img) img.hidden = true; return; }
      if (!img) { img = mark(document.createElement("img")); img.className = "mm-hero-img"; img.alt = ""; img.decoding = "async"; hero.insertBefore(img, hero.firstChild); }
      if (img.getAttribute("src") !== a.cover) img.setAttribute("src", a.cover);
      img.hidden = false;
    }
    function signal() {
      var p = window.UG && window.UG.player, el = top.querySelector(".mm-sig");
      el.classList.toggle("on", !!(p && p.playing));
      el.querySelector("span").textContent = p && p.playing && p.track ? "On air · " + p.track.artist : "Basement signal";
    }
    photo(); signal();
    on(document, "ug:data", photo);
    on(document, "ug:player", signal);

    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
