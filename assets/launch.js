/* UNDERGROUND — launch motion (see launch.css).
   UGLaunch.intro(splashEl) plays the first-open version; UGLaunch.view(viewEl) the short page-change one. */
(() => {
  const NAMES = { "01": "Neon Ignite", "02": "Amp Power-On", "03": "Curtain Drop", "04": "Bass Drop", "05": "Glitch Boot",
    "06": "Vinyl Spin-Up", "07": "Equalizer Rise", "08": "Spotlight Sweep", "09": "Mosh Pit", "10": "Smoke Reveal" };
  const INTRO_MS = { "01": 1500, "02": 1350, "03": 1400, "04": 1300, "05": 1200, "06": 1500, "07": 1400, "08": 1600, "09": 1300, "10": 1500 };
  const SHORT_OVERLAY = { "03": 700, "05": 450, "07": 650, "08": 600 };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PREVIEW = location.hostname !== "music.mikasa.me";
  const DEFAULT = "01";

  let pick = new URLSearchParams(location.search).get("lm");
  if (!NAMES[pick]) { try { pick = localStorage.getItem("ug_lm"); } catch (e) { pick = null; } }
  let id = PREVIEW && NAMES[pick] ? pick : DEFAULT;
  let introUntil = 0, timer = 0;
  if (!reduce) document.body.dataset.lm = id;

  const LOGO = '<div class="lm-logo"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M14 9v15a10 10 0 0 0 20 0V9" stroke="#FF5C86" stroke-width="3.2" stroke-linecap="round"/><path d="M14 9v15a10 10 0 0 0 20 0V9" stroke="#FFE3EC" stroke-width="1.2" stroke-linecap="round"/></svg><div class="lm-word">UNDERGROUND</div></div>';
  function inner(m, short) {
    if (m === "03") return '<div class="cl"></div><div class="cr"></div>' + (short ? "" : LOGO);
    if (m === "04") return '<div class="ring"></div>';
    if (m === "06") return '<div class="disc"></div>';
    if (m === "07") {
      let s = ""; const n = innerWidth < 700 ? 10 : 18;
      for (let k = 0; k < n; k++) s += `<i style="--k:${Math.abs(k - (n - 1) / 2) | 0};--h:${(Math.sin(k * 2.3) + 1) / 2}"></i>`;
      return s;
    }
    if (m === "10") return '<div class="s"></div><div class="s"></div><div class="s"></div>' + LOGO;
    if (m === "01" || m === "09") return LOGO;
    return "";
  }
  function overlay(short, ms) {
    document.getElementById("lm")?.remove();
    const el = document.createElement("div");
    el.id = "lm"; el.className = "m" + id + (short ? " short" : ""); el.setAttribute("aria-hidden", "true");
    el.innerHTML = inner(id, short);
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }
  function sides(viewEl) {
    viewEl.querySelectorAll(".bento-item").forEach((el, i) => { el.dataset.lmSide = i % 2 ? "r" : "l"; });
  }

  window.UGLaunch = {
    get id() { return id; },
    intro(splash) {
      if (splash) splash.remove();
      if (reduce) return;
      const ms = INTRO_MS[id];
      clearTimeout(timer);
      document.body.classList.remove("lm-intro"); void document.body.offsetWidth;
      document.body.classList.add("lm-intro");
      introUntil = performance.now() + ms;
      overlay(false, ms);
      timer = setTimeout(() => document.body.classList.remove("lm-intro"), ms + 400);
    },
    view(viewEl) {
      if (reduce || !viewEl) return;
      sides(viewEl);
      if (performance.now() < introUntil) return; // first open already covers it
      if (SHORT_OVERLAY[id]) overlay(true, SHORT_OVERLAY[id]);
    },
  };

  // Preview deployments only: a picker to compare the 10 motions on the real site.
  if (!PREVIEW || reduce) return;
  const bar = document.createElement("div");
  bar.className = "lm-pick";
  bar.innerHTML = `<b>MOTION</b><select aria-label="Launch motion">${Object.entries(NAMES).map(([k, v]) => `<option value="${k}"${k === id ? " selected" : ""}>${k} ${v}</option>`).join("")}</select><button type="button" class="go" title="Replay first open">↻ Replay</button>`;
  const replay = () => {
    window.UGLaunch.intro();
    const v = document.querySelector(".view:not([hidden])");
    if (v && window.UGReenter) window.UGReenter(v);
  };
  bar.querySelector("select").addEventListener("change", (e) => {
    id = e.target.value; document.body.dataset.lm = id;
    try { localStorage.setItem("ug_lm", id); } catch (err) { /* private mode */ }
    const u = new URL(location.href); u.searchParams.set("lm", id); history.replaceState(history.state, "", u);
    replay();
  });
  bar.querySelector("button").addEventListener("click", replay);
  document.addEventListener("DOMContentLoaded", () => document.body.append(bar));
  if (document.readyState !== "loading") document.body.append(bar);
})();
