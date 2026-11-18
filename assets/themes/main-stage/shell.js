// 06 · Main Stage — story counter ("03 / 24") while scrolling the full-screen story slides, and
// scroll snapping on the article list only.
(function () {
  "use strict";
  var ID = "main-stage";

  function mount() {
    var undo = [];
    function on(t, e, f, o) { t.addEventListener(e, f, o); undo.push(function () { t.removeEventListener(e, f, o); }); }
    var main = document.getElementById("main");
    var count = document.createElement("div");
    count.className = "ms-count"; count.hidden = true; count.setAttribute("aria-hidden", "true"); count.setAttribute("data-ug-shell", "");
    document.body.appendChild(count);

    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    function update() {
      var inList = window.UG && window.UG.view === "articles";
      main.classList.toggle("ms-snap", !!inList);
      var cards = inList ? document.querySelectorAll("#grid > .acard") : [];
      if (!cards.length) { count.hidden = true; return; }
      var mid = main.getBoundingClientRect().top + main.clientHeight / 2, cur = 0;
      for (var i = 0; i < cards.length; i++) if (cards[i].getBoundingClientRect().top <= mid) cur = i + 1;
      count.hidden = cur === 0;
      count.innerHTML = pad(cur) + " <small>/ " + pad(cards.length) + "</small>";
    }
    var raf = 0;
    on(main, "scroll", function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }, { passive: true });
    on(document, "ug:view", update);
    on(document, "ug:data", update);
    update();
    return function () { undo.forEach(function (f) { f(); }); main.classList.remove("ms-snap"); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
