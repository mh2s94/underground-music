// 01 · Front Page — masthead with date, edition number and tagline above the section menu.
// Uses only window.UG (data) and UGTheme.registerShell (lifecycle); everything it adds is removed
// when the theme changes.
(function () {
  "use strict";
  var ID = "front-page";

  function mount() {
    var undo = [];
    var app = document.querySelector(".app");
    var mast = document.createElement("header");
    mast.className = "fp-mast";
    mast.setAttribute("data-ug-shell", "");
    mast.innerHTML =
      '<div class="fp-meta"><span class="fp-date"></span><span class="fp-ed"></span><span>Independent · Heavy · Underground</span></div>' +
      '<a class="fp-title" href="#/home">Underground</a>' +
      '<div class="fp-tag">All the noise that’s fit to print</div>';
    app.insertBefore(mast, app.firstChild);

    function fill() {
      var UG = window.UG;
      var d = new Date();
      mast.querySelector(".fp-date").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      var n = UG && UG.articles ? UG.articles.length : 0;
      mast.querySelector(".fp-ed").textContent = n ? "No. " + n + " · " + new Date().getFullYear() : "";
    }
    fill();
    var onData = function () { fill(); };
    document.addEventListener("ug:data", onData);
    undo.push(function () { document.removeEventListener("ug:data", onData); });

    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
