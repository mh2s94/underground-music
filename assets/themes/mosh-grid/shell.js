// 04 · Mosh Grid — on phones the corner menu folds into one "MENU" button; this adds that button
// and keeps the box open/closed state (closed after every navigation).
(function () {
  "use strict";
  var ID = "mosh-grid";

  function mount() {
    var undo = [];
    function on(t, e, f) { t.addEventListener(e, f); undo.push(function () { t.removeEventListener(e, f); }); }
    var side = document.querySelector(".sidebar");
    var nav = side.querySelector(".nav");
    if (!nav.id) nav.id = "ugNav";
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "mg-toggle"; btn.textContent = "Menu";
    btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", nav.id);
    btn.setAttribute("data-ug-shell", "");
    side.insertBefore(btn, side.firstChild);

    function set(open) { side.classList.toggle("mg-open", open); btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "Close" : "Menu"; }
    on(btn, "click", function () { set(!side.classList.contains("mg-open")); });
    on(document, "ug:view", function () { set(false); });
    on(document, "keydown", function (e) { if (e.key === "Escape" && side.classList.contains("mg-open")) { set(false); btn.focus(); } });

    return function () { undo.forEach(function (f) { f(); }); side.classList.remove("mg-open"); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
