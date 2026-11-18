// 05 · Control Room 2.0 — monitor panel on the right: clock, on-air status of the player,
// story/track counters and the latest five headlines (open the reader). Wide screens only (CSS).
(function () {
  "use strict";
  var ID = "control-room";

  function mount() {
    var undo = [];
    function on(t, e, f) { t.addEventListener(e, f); undo.push(function () { t.removeEventListener(e, f); }); }
    var app = document.querySelector(".app");
    var esc = function (s) { return window.UG && window.UG.helpers ? window.UG.helpers.esc(s) : String(s || "").replace(/[&<>"']/g, ""); };

    var panel = document.createElement("aside");
    panel.className = "cr-panel"; panel.setAttribute("data-ug-shell", ""); panel.setAttribute("aria-label", "Monitor");
    panel.innerHTML =
      '<div class="cr-box"><div class="cr-h"><span>Local time</span><span class="cr-tz"></span></div><div class="cr-clock" aria-hidden="true">--:--</div></div>' +
      '<div class="cr-box"><div class="cr-h"><span>Studio</span></div><span class="cr-air" role="status"><i></i><span>Off air</span></span><div class="cr-np"></div></div>' +
      '<div class="cr-box"><div class="cr-h"><span>Archive</span></div><div class="cr-meters"><div><b class="cr-a">0</b>stories</div><div><b class="cr-t">0</b>tracks</div></div></div>' +
      '<div class="cr-box"><div class="cr-h"><span>Latest</span></div><ul class="cr-feed"></ul></div>' +
      '<div class="cr-box cr-slot" aria-hidden="true">Player docks here</div>';
    app.appendChild(panel);

    function clock() {
      var d = new Date();
      panel.querySelector(".cr-clock").textContent = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      try { panel.querySelector(".cr-tz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop().replace(/_/g, " "); } catch (e) { /* ignore */ }
    }
    function data() {
      var UG = window.UG; if (!UG) return;
      panel.querySelector(".cr-a").textContent = UG.articles.length;
      panel.querySelector(".cr-t").textContent = UG.tracks.length;
      panel.querySelector(".cr-feed").innerHTML = UG.articles.slice(0, 5).map(function (a) {
        return '<li><button type="button" data-key="' + esc(a.key) + '">' + esc(a.title) + "<small>" + esc(a.genre || "") + " · " + esc(UG.helpers.timeAgo(a.publishedAt)) + "</small></button></li>";
      }).join("");
    }
    function air() {
      var UG = window.UG, p = UG && UG.player, t = p && p.track;
      var el = panel.querySelector(".cr-air");
      el.classList.toggle("on", !!(p && p.playing));
      el.querySelector("span").textContent = p && p.playing ? "On air" : "Off air";
      panel.querySelector(".cr-np").textContent = t ? t.title + " — " + t.artist : "Nothing cued";
    }
    clock(); data(); air();
    var timer = setInterval(clock, 15000);
    undo.push(function () { clearInterval(timer); });
    on(document, "ug:data", data);
    on(document, "ug:player", air);
    on(panel, "click", function (e) { var b = e.target.closest("[data-key]"); if (b && window.UG) window.UG.actions.openArticle(b.getAttribute("data-key")); });

    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
