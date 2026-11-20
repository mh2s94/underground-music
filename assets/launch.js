/* UNDERGROUND — launch motion 09 "Mosh Pit" (see launch.css).
   UGLaunch.intro(splashEl) plays the first-open version; UGLaunch.view(viewEl) the short page-change one. */
(() => {
  const ID = "09", INTRO_MS = 1300;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let introUntil = 0, timer = 0;
  if (!reduce) document.body.dataset.lm = ID;

  const LOGO = '<div class="lm-logo"><img src="/assets/icon-512.png" alt="" width="112" height="112"><div class="lm-word">UNDERGROUND</div></div>';
  window.UGLaunch = {
    intro(splash) {
      if (splash) splash.remove();
      if (reduce) return;
      clearTimeout(timer);
      document.body.classList.add("lm-intro");
      introUntil = performance.now() + INTRO_MS;
      const el = document.createElement("div");
      el.id = "lm"; el.className = "m" + ID; el.setAttribute("aria-hidden", "true"); el.innerHTML = LOGO;
      document.body.append(el);
      setTimeout(() => el.remove(), INTRO_MS);
      timer = setTimeout(() => document.body.classList.remove("lm-intro"), INTRO_MS + 400);
    },
    view(viewEl) {
      if (reduce || !viewEl) return;
      viewEl.querySelectorAll(".bento-item").forEach((el, i) => { el.dataset.lmSide = i % 2 ? "r" : "l"; }); // cards fly in from alternating sides
    },
  };
})();
