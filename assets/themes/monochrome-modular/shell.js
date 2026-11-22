// 11 · Monochrome Modular — editorial shell.
// A floating glass top bar with the modular mark (mm-mark), the site's own nav relocated into an
// animated tab rail with one sliding indicator, a mobile drawer, a "Basement signal" that follows
// the player, the newest story cover as a grayscale hero photo, and the ticker + hero lifted above
// both dashboard columns (put back on cleanup). Content, data and interactions are the site's own.
(function () {
  "use strict";
  var ID = "monochrome-modular";
  var MARK = '<svg class="mm-mark" width="38" height="24" viewBox="0 0 64 40" fill="none" role="img" aria-hidden="true" focusable="false"><path d="M2 20h7l5-11 7 22 7-17 6 10 7-16 7 24 6-12h10" stroke="currentColor" stroke-width="3.2" stroke-linecap="square" stroke-linejoin="miter"/></svg>';

  function mount() {
    var undo = [];
    function on(t, e, f, o) { t.addEventListener(e, f, o); undo.push(function () { t.removeEventListener(e, f, o); }); }
    function mark(el) { el.setAttribute("data-ug-shell", ""); return el; }
    function made(tag, cls) { var el = document.createElement(tag); el.className = cls; return mark(el); }
    function move(el, parent) {
      if (!el || !parent) return;
      var from = { p: el.parentNode, n: el.nextSibling };
      parent.appendChild(el);
      undo.push(function () { if (from.p) from.p.insertBefore(el, from.n); });
    }

    var main = document.getElementById("main");
    var nav = document.querySelector(".sidebar .nav") || document.querySelector(".nav");
    var admin = document.getElementById("adminLink");
    var home = document.querySelector("#view-home .home");
    var hero = document.querySelector("#view-home .hero");
    var ticker = document.querySelector("#view-home .ticker");

    // ---- floating top bar -------------------------------------------------
    var top = made("header", "mm-top");

    var brand = document.createElement("a");
    brand.className = "mm-brand"; brand.href = "#/home"; brand.setAttribute("aria-label", "UNDERGROUND home");
    brand.innerHTML = MARK + '<span class="mm-brand-txt"><span class="mm-name">UNDERGROUND</span><span class="mm-tag">Music / Culture / Scene</span></span>';

    var navwrap = made("div", "mm-navwrap");
    move(nav, navwrap);

    var actions = document.createElement("div"); actions.className = "mm-actions";
    var sig = document.createElement("span"); sig.className = "mm-sig"; sig.setAttribute("role", "status");
    sig.innerHTML = '<i aria-hidden="true"></i><span>Basement signal</span>';
    var burger = document.createElement("button");
    burger.type = "button"; burger.className = "mm-burger";
    burger.setAttribute("aria-label", "Open menu"); burger.setAttribute("aria-expanded", "false");
    burger.innerHTML = "<span></span><span></span><span></span>";
    move(admin, actions);           // admin link (already hidden unless an admin is signed in)
    actions.appendChild(sig);
    actions.appendChild(burger);

    top.appendChild(brand); top.appendChild(navwrap); top.appendChild(actions);
    if (main) main.insertBefore(top, main.firstChild);

    // ---- mobile drawer ----------------------------------------------------
    var scrim = made("div", "mm-scrim");
    document.body.appendChild(scrim);
    function setOpen(open) {
      top.classList.toggle("mm-open", open);
      document.body.classList.toggle("mm-locked", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      if (open) requestAnimationFrame(placePill);
    }
    on(burger, "click", function () { setOpen(!top.classList.contains("mm-open")); });
    on(scrim, "click", function () { setOpen(false); });
    on(document, "keydown", function (e) { if (e.key === "Escape") setOpen(false); });
    on(navwrap, "click", function (e) { if (e.target.closest && e.target.closest(".nav-btn")) setOpen(false); });

    // ---- one sliding active indicator for the tab rail --------------------
    var pill = document.getElementById("navPill");
    function placePill() {
      if (!pill || !nav) return;
      var btn = nav.querySelector('.nav-btn[aria-current="page"]') || nav.querySelector(".nav-btn");
      if (!btn) return;
      pill.style.width = btn.offsetWidth + "px";
      pill.style.height = btn.offsetHeight + "px";
      pill.style.transform = "translate(" + btn.offsetLeft + "px," + btn.offsetTop + "px)";
    }
    var ro = window.MutationObserver ? new MutationObserver(placePill) : null;
    if (ro && nav) ro.observe(nav, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
    undo.push(function () { if (ro) ro.disconnect(); });
    on(document, "ug:view", function () { placePill(); setTimeout(placePill, 80); });
    on(window, "resize", placePill);
    placePill();

    // ---- bar reacts to scrolling -----------------------------------------
    function onScroll() { top.classList.toggle("scrolled", (main ? main.scrollTop : 0) > 8); }
    if (main) on(main, "scroll", onScroll, { passive: true });
    onScroll();

    // ---- lift ticker + hero into one full-width lead block ----------------
    var spots = [];
    if (home && hero) {
      var lead = made("div", "mm-lead");
      [ticker, hero].forEach(function (el) {
        if (!el) return;
        spots.push({ el: el, parent: el.parentNode, next: el.nextSibling });
        lead.appendChild(el);
      });
      home.parentNode.insertBefore(lead, home);
      undo.push(function () { for (var i = spots.length - 1; i >= 0; i--) { var s = spots[i]; s.parent.insertBefore(s.el, s.next); } });
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
      var p = window.UG && window.UG.player;
      sig.classList.toggle("on", !!(p && p.playing));
      sig.querySelector("span").textContent = p && p.playing && p.track ? "On air · " + p.track.artist : "Basement signal";
    }
    photo(); signal();
    on(document, "ug:data", photo);
    on(document, "ug:player", signal);

    // ---- scroll reveal (opt-in; only when motion is allowed) --------------
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && main && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("ug-in"); io.unobserve(en.target); } });
      }, { root: main, rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
      // Elements already on screen keep the site's own view-entrance animation; only the ones below
      // the fold are handed to the observer, so they settle in as the reader scrolls.
      function inView(el, box) {
        if (!el.getClientRects().length) return false;    // a hidden view: leave it for when it opens
        var r = el.getBoundingClientRect();
        return r.top < box.bottom && r.bottom > box.top - 40;
      }
      function scan() {
        var box = main.getBoundingClientRect();
        main.querySelectorAll(".bento-item:not(.ug-reveal), .card:not(.ug-reveal)").forEach(function (el) {
          if (inView(el, box)) return;
          el.classList.add("ug-reveal"); io.observe(el);
        });
      }
      scan();
      var mo = window.MutationObserver ? new MutationObserver(scan) : null;
      if (mo) { mo.observe(main, { childList: true, subtree: true }); undo.push(function () { mo.disconnect(); }); }
      on(document, "ug:view", scan);
      undo.push(function () {
        io.disconnect();
        main.querySelectorAll(".ug-reveal").forEach(function (el) { el.classList.remove("ug-reveal", "ug-in"); });
      });
    }

    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
