// 10 · Scene Atlas — genre map at the top of the home page. One pin per genre of the published
// stories, sized by the number of stories, laid out on a fixed spiral (same place every visit).
// A pin (or its twin in the keyboard-friendly legend below the map) opens the article list
// filtered to that genre through the site's own genre filter.
(function () {
  "use strict";
  var ID = "scene-atlas";

  function mount() {
    var undo = [];
    function on(t, e, f) { t.addEventListener(e, f); undo.push(function () { t.removeEventListener(e, f); }); }
    var home = document.querySelector("#view-home .home");
    if (!home) return null;
    var map = document.createElement("section");
    map.className = "sa-map"; map.setAttribute("data-ug-shell", ""); map.setAttribute("aria-label", "Genre map");
    map.innerHTML = '<div class="sa-head"><b>The scene, mapped</b><span class="sa-sub"></span></div><div class="sa-field"></div><div class="sa-legend" role="group" aria-label="Genres"></div>';
    home.parentNode.insertBefore(map, home);

    function esc(s) { return window.UG.helpers.esc(s); }
    function render() {
      var UG = window.UG; if (!UG) return;
      var counts = {};
      UG.articles.forEach(function (a) { var g = a.genre || "Underground"; counts[g] = (counts[g] || 0) + 1; });
      var list = Object.keys(counts).map(function (g) { return [g, counts[g]]; }).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, 18);
      var field = map.querySelector(".sa-field"), legend = map.querySelector(".sa-legend");
      map.querySelector(".sa-sub").textContent = list.length + " genres · " + UG.articles.length + " stories";
      if (!list.length) { field.innerHTML = '<div class="sa-empty">The map fills in as stories are published.</div>'; legend.innerHTML = ""; return; }
      var max = list[0][1], golden = Math.PI * (3 - Math.sqrt(5));
      field.innerHTML = list.map(function (it, i) {
        var r = i === 0 ? 0 : 14 + 30 * Math.sqrt(i / list.length);          // % of the field
        var x = 50 + r * Math.cos(i * golden) * 1.15, y = 52 + r * Math.sin(i * golden) * .8;
        var size = Math.round(34 + 50 * Math.sqrt(it[1] / max));
        return '<button type="button" class="sa-pin' + (i % 3 === 1 ? " alt" : "") + '" data-g="' + esc(it[0]) + '" style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + "%;width:" + size + "px;height:" + size + 'px" aria-label="' + esc(it[0]) + ": " + it[1] + ' stories"><b>' + it[1] + "</b><span>" + esc(it[0]) + "</span></button>";
      }).join("");
      legend.innerHTML = list.map(function (it) { return '<button type="button" data-g="' + esc(it[0]) + '">' + esc(it[0]) + "<b>" + it[1] + "</b></button>"; }).join("");
    }
    on(map, "click", function (e) {
      var b = e.target.closest("[data-g]"); if (!b || !window.UG) return;
      var g = b.getAttribute("data-g");
      window.UG.actions.go("/articles");
      setTimeout(function () {
        var pills = document.querySelectorAll("#pills [data-g]");
        for (var i = 0; i < pills.length; i++) if (pills[i].getAttribute("data-g") === g) { pills[i].click(); break; }
      }, 60);
    });
    on(document, "ug:data", render);
    render();
    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
