// 02 · The Pit — top bar with a MENU button and a full-screen numbered text menu.
// The menu holds every destination of the icon rail (which this theme hides), plus search.
// Keyboard: Escape closes, focus moves into the menu and back to the button.
(function () {
  "use strict";
  var ID = "the-pit";
  var ITEMS = [["home", "Home"], ["articles", "Articles"], ["music", "Music"], ["charts", "Charts"], ["about", "About"], ["account", "Account"], ["search", "Search"]];

  function mount() {
    var undo = [];
    function on(t, e, f) { t.addEventListener(e, f); undo.push(function () { t.removeEventListener(e, f); }); }
    var app = document.querySelector(".app");

    var bar = document.createElement("div");
    bar.className = "pit-bar"; bar.setAttribute("data-ug-shell", "");
    bar.innerHTML = '<a class="pit-logo" href="#/home">Underground</a><span class="pit-where" aria-live="polite"></span>' +
      '<button class="pit-btn" type="button" aria-expanded="false" aria-controls="pitMenu">Menu</button>';
    app.insertBefore(bar, app.firstChild);

    var menu = document.createElement("div");
    menu.className = "pit-menu"; menu.id = "pitMenu"; menu.hidden = true;
    menu.setAttribute("role", "dialog"); menu.setAttribute("aria-modal", "true"); menu.setAttribute("aria-label", "Menu");
    menu.setAttribute("data-ug-shell", "");
    menu.innerHTML = '<div class="pit-menu-top"><span>Underground · Menu</span><button class="pit-close" type="button">Close</button></div><ol>' +
      ITEMS.map(function (it) { return '<li><button type="button" data-go="' + it[0] + '">' + it[1] + "</button></li>"; }).join("") + "</ol>";
    document.body.appendChild(menu);

    var btn = bar.querySelector(".pit-btn");
    function setWhere() {
      var v = (window.UG && window.UG.view) || "home";
      bar.querySelector(".pit-where").textContent = "Now: " + v;
      menu.querySelectorAll("[data-go]").forEach(function (b) { if (b.getAttribute("data-go") === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    }
    function open() { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); setWhere(); var f = menu.querySelector("[aria-current]") || menu.querySelector("[data-go]"); if (f) f.focus(); }
    function close(back) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (back) btn.focus(); }

    on(btn, "click", open);
    on(menu.querySelector(".pit-close"), "click", function () { close(true); });
    on(menu, "click", function (e) {
      var b = e.target.closest("[data-go]"); if (!b || !window.UG) return;
      var to = b.getAttribute("data-go");
      close(false);
      if (to === "search") window.UG.actions.openSearch(); else window.UG.actions.go("/" + to);
    });
    on(document, "keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { e.stopPropagation(); close(true); } });
    on(document, "ug:view", setWhere);
    setWhere();

    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
