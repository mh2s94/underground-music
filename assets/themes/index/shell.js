// 08 · Index — column header row above the article index table.
(function () {
  "use strict";
  var ID = "index";

  function mount() {
    var grid = document.getElementById("grid");
    if (!grid) return null;
    var head = document.createElement("div");
    head.className = "ix-head"; head.setAttribute("data-ug-shell", ""); head.setAttribute("aria-hidden", "true");
    head.innerHTML = "<span>No.</span><span>Title</span><span>Genre</span><span>Date</span><span style=\"text-align:right\">Read</span>";
    grid.parentNode.insertBefore(head, grid);
    return null;
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
