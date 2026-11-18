// 07 · Xerox Zine — cut-out "ransom note" masthead with the issue number (= number of stories)
// and the month, at the top of every page.
(function () {
  "use strict";
  var ID = "xerox-zine";
  var CLS = ["", "i", "", "p", "", "i", "", "", "p", "", "i"];   // fixed pattern: same look on every visit

  function mount() {
    var undo = [];
    var main = document.getElementById("main");
    var mast = document.createElement("div");
    mast.className = "xz-mast"; mast.setAttribute("data-ug-shell", "");
    mast.innerHTML = '<div class="xz-word" role="img" aria-label="Underground">' +
      "UNDERGROUND".split("").map(function (c, i) { return '<span class="' + CLS[i] + '" aria-hidden="true">' + c + "</span>"; }).join("") +
      '</div><div class="xz-issue"><b class="xz-no"></b><span class="xz-month"></span> · photocopy &amp; pass it on</div>';
    main.insertBefore(mast, main.firstChild);

    function fill() {
      var n = window.UG && window.UG.articles ? window.UG.articles.length : 0;
      mast.querySelector(".xz-no").textContent = "issue #" + (n || "—");
      mast.querySelector(".xz-month").textContent = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toLowerCase();
    }
    fill();
    document.addEventListener("ug:data", fill);
    undo.push(function () { document.removeEventListener("ug:data", fill); });
    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
