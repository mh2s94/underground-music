// 09 · Frequency — tuning dial in the radio dock: the current channel as a frequency, what is on
// air, and a "Tune in" button that plays the first track of the library (or pauses/resumes).
(function () {
  "use strict";
  var ID = "frequency";
  var MHZ = { home: "88.1", articles: "91.4", music: "94.7", charts: "98.3", about: "101.6", account: "104.2", band: "106.9" };

  function mount() {
    var undo = [];
    function on(t, e, f) { t.addEventListener(e, f); undo.push(function () { t.removeEventListener(e, f); }); }
    var side = document.querySelector(".sidebar");
    var dial = document.createElement("div");
    dial.className = "fq-dial"; dial.setAttribute("data-ug-shell", "");
    dial.innerHTML = '<span class="fq-mhz"></span><span class="fq-now" role="status"></span><button class="fq-tune" type="button">Tune in</button><span class="fq-scale" aria-hidden="true"><i></i></span>';
    side.insertBefore(dial, side.firstChild);

    function render() {
      var UG = window.UG; if (!UG) return;
      var v = UG.view || "home", f = MHZ[v] || "88.1";
      dial.querySelector(".fq-mhz").innerHTML = f + "<small>FM</small>";
      dial.querySelector(".fq-scale i").style.left = ((parseFloat(f) - 87) / 21 * 100).toFixed(1) + "%";
      var p = UG.player, t = p && p.track;
      dial.querySelector(".fq-now").innerHTML = t
        ? "<small>" + (p.playing ? "On air" : "Paused") + "</small>" + UG.helpers.esc(t.title + " — " + t.artist)
        : "<small>Channel</small>" + UG.helpers.esc(v.charAt(0).toUpperCase() + v.slice(1));
      var b = dial.querySelector(".fq-tune");
      b.disabled = !t && !UG.tracks.length;
      b.textContent = t ? (p.playing ? "Pause" : "Resume") : "Tune in";
    }
    on(dial.querySelector(".fq-tune"), "click", function () {
      var UG = window.UG; if (!UG) return;
      if (UG.player && UG.player.track) UG.actions.togglePlay();
      else if (UG.tracks.length) UG.actions.playTrack(UG.tracks[0].id);
    });
    on(document, "ug:view", render);
    on(document, "ug:player", render);
    on(document, "ug:data", render);
    render();
    return function () { undo.forEach(function (f) { f(); }); };
  }

  if (window.UGTheme && window.UGTheme.registerShell) window.UGTheme.registerShell(ID, mount);
})();
