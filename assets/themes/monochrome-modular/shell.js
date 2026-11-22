// Monochrome Modular (skin: LIVE SIGNAL) — a broadcast masthead with a news ticker, a monitor "stage"
// on the dashboard hero (signal word + VU meter + caption), the site-wide CRT overlays, a top progress
// bar and a custom cursor. Presentation only; content, data and interactions are the site's own.
(function () {
  "use strict";
  var ID = "monochrome-modular";
  var MARK = '<svg class="mm-mark" width="38" height="24" viewBox="0 0 64 40" fill="none" role="img" aria-hidden="true" focusable="false"><path d="M2 20h7l5-11 7 22 7-17 6 10 7-16 7 24 6-12h10" stroke="currentColor" stroke-width="3.2" stroke-linecap="square" stroke-linejoin="miter"/></svg>';
  var TAPE = '<span>SIGNAL LOCKED</span><span>LIVE FROM THE PIT</span><span>BASEMENT RADIO</span><span>NEW TRANSMISSION</span><span>RAW TAKES</span><span>VOLUME 11</span><span>SCENE RADAR</span><span>DEAD AIR: NONE</span>';
  // The skin's own typefaces (Archivo Black display, Chakra Petch "tech", JetBrains Mono labels).
  var FONTS = "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap";

  function mount() {
    var undo = [];
    function on(t, e, f, o) { t.addEventListener(e, f, o); undo.push(function () { t.removeEventListener(e, f, o); }); }
    function mark(el) { el.setAttribute("data-ug-shell", ""); return el; }
    var main = document.getElementById("main");
    var side = document.querySelector(".sidebar");
    var home = document.querySelector("#view-home .home");
    var hero = document.querySelector("#view-home .hero");
    var ticker = document.querySelector("#view-home .ticker");

    // ---- skin typefaces ----
    var fonts = document.createElement("link");
    fonts.rel = "stylesheet"; fonts.href = FONTS; fonts.setAttribute("data-ug-shell", "");
    document.head.appendChild(fonts);
    undo.push(function () { fonts.remove(); });

    // ---- broadcast masthead: wordmark row over a news ticker ----
    var top = mark(document.createElement("header"));
    top.className = "mm-top";
    top.innerHTML =
      '<div class="mm-row">' +
        '<a class="mm-brand" href="#/" aria-label="UNDERGROUND home">' +
          '<span class="mm-markbox">' + MARK + '</span>' +
          '<span><span class="mm-name">Underground</span><span class="mm-tag">EXTREME MUSIC · LIVE SIGNAL</span></span>' +
        '</a>' +
        '<div class="mm-right">' +
          '<span class="mm-issue">CH-01 · MASTER</span>' +
          '<span class="mm-sig" role="status"><i aria-hidden="true"></i><span>Basement signal</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="mm-tape" aria-hidden="true"><div class="mm-tape-in">' + TAPE + TAPE + '</div></div>';
    if (main) main.insertBefore(top, main.firstChild);

    // ---- vertical label on the rail ----
    if (side) {
      var vert = mark(document.createElement("div"));
      vert.className = "mm-vert"; vert.setAttribute("aria-hidden", "true"); vert.textContent = "LIVE SIGNAL / INDEPENDENT MUSIC CULTURE";
      side.insertBefore(vert, side.querySelector(".sidebar-foot"));
    }

    // ---- CRT overlays: grain, scanlines (with a cyan sweep) and vignette ----
    var fx = mark(document.createElement("div"));
    fx.className = "mm-fx"; fx.setAttribute("aria-hidden", "true");
    fx.innerHTML = '<i class="mm-grain"></i><i class="mm-scan"></i><i class="mm-vig"></i>';
    document.body.appendChild(fx);
    undo.push(function () { fx.remove(); });

    // ---- top progress bar ----
    var prog = mark(document.createElement("div"));
    prog.className = "mm-prog"; prog.setAttribute("aria-hidden", "true");
    document.body.appendChild(prog);
    function meter() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var y = window.pageYOffset || doc.scrollTop || 0;
      prog.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
    }
    on(window, "scroll", meter, { passive: true });
    meter();
    undo.push(function () { prog.remove(); });

    // ---- custom cursor (pointer devices only) ----
    if (window.matchMedia && window.matchMedia("(hover: hover)").matches) {
      var cur = mark(document.createElement("div"));
      cur.className = "mm-cursor"; cur.setAttribute("aria-hidden", "true");
      cur.innerHTML = '<span class="mm-cdot"></span>';
      document.body.appendChild(cur);
      var cx = 0, cy = 0, rx = 0, ry = 0, raf = 0;
      on(window, "mousemove", function (e) {
        cx = e.clientX; cy = e.clientY;
        var hot = e.target && e.target.closest && e.target.closest("a,button,.card,.pill");
        cur.classList.toggle("hot", !!hot);
      });
      (function loop() { rx += (cx - rx) * 0.16; ry += (cy - ry) * 0.16; cur.style.transform = "translate(" + rx + "px," + ry + "px)"; raf = requestAnimationFrame(loop); })();
      undo.push(function () { cancelAnimationFrame(raf); cur.remove(); });
    }

    // ---- lift ticker + hero above both columns; remember where they were ----
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

    // ---- hero monitor: waveform, big signal word, VU meter, caption + clock ----
    if (hero) {
      var bars = "", i;
      for (i = 0; i < 46; i++) bars += '<i style="animation-delay:' + (i * 0.04).toFixed(2) + 's;animation-duration:' + (0.7 + (i % 7) * 0.12).toFixed(2) + 's"></i>';
      var vu = "";
      for (i = 0; i < 22; i++) vu += '<i style="animation-delay:' + (i * 0.06).toFixed(2) + 's;animation-duration:' + (0.6 + (i % 5) * 0.16).toFixed(2) + 's"></i>';
      var stage = mark(document.createElement("div"));
      stage.className = "mm-stage"; stage.setAttribute("aria-hidden", "true");
      stage.innerHTML =
        '<div class="mm-big">SIGNAL</div>' +
        '<div class="mm-vu">' + vu + '</div>' +
        '<div class="mm-cap"><span>CH-01 / MASTER</span><span class="mm-clock">--:--:--</span></div>';
      var wave = mark(document.createElement("div"));
      wave.className = "mm-wave"; wave.setAttribute("aria-hidden", "true");
      wave.innerHTML = bars;
      hero.appendChild(wave);
      hero.appendChild(stage);
      undo.push(function () { wave.remove(); stage.remove(); });

      var clock = stage.querySelector(".mm-clock");
      function tick() { var d = new Date(); if (clock) clock.textContent = d.toTimeString().slice(0, 8); }
      tick();
      var timer = setInterval(tick, 1000);
      undo.push(function () { clearInterval(timer); });
    }

    function signal() {
      var p = window.UG && window.UG.player, el = top.querySelector(".mm-sig");
      if (!el) return;
      el.classList.toggle("on", !!(p && p.playing));
      el.querySelector("span").textContent = p && p.playing && p.track ? "ON AIR · " + p.track.artist : "Basement signal";
    }
    function words() {
      var UG = window.UG; if (!hero || !UG) return;
      var a = (UG.articles || [])[0];
      var big = hero.querySelector(".mm-big");
      if (big && a && a.genre) big.textContent = String(a.genre).toUpperCase();
    }
    signal(); words();
    on(document, "ug:data", words);
    on(document, "ug:player", signal);

    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
