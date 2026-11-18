// 03 · Setlist — "tonight" header at the top of the column: date, story and track counts.
(function () {
  "use strict";
  var ID = "setlist";

  function mount() {
    var undo = [];
    var main = document.getElementById("main");
    var head = document.createElement("div");
    head.className = "sl-head"; head.setAttribute("data-ug-shell", "");
    head.innerHTML = '<div><span>Tonight’s setlist</span><b class="sl-date"></b></div><div class="sl-count"><span class="sl-n"></span></div>';
    main.insertBefore(head, main.firstChild);

    function fill() {
      var UG = window.UG;
      head.querySelector(".sl-date").textContent = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      var a = UG && UG.articles ? UG.articles.length : 0, t = UG && UG.tracks ? UG.tracks.length : 0;
      head.querySelector(".sl-n").textContent = a + " stories · " + t + " tracks";
    }
    fill();
    document.addEventListener("ug:data", fill);
    undo.push(function () { document.removeEventListener("ug:data", fill); });
    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
