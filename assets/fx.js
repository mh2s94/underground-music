/* UNDERGROUND — interaction effects (see fx.css). Exposes window.UGFx.reveal(viewEl) for bento.js. */
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 1. Glitch on the hero title */
  const title = document.querySelector(".hero h1");
  if (title && !reduce) {
    title.classList.add("glitch");
    title.dataset.text = title.textContent.replace(/\s+/g, " ").trim();
    const burst = (ms) => { title.classList.add("burst"); setTimeout(() => title.classList.remove("burst"), ms); };
    title.addEventListener("click", () => burst(900));
    setTimeout(() => burst(700), 2600); // once, after the launch motion
  }

  /* 2 + 6. Spotlight on lift cards, tilt on article cards (mouse, pen or finger) */
  let lit = null;
  const off = (c) => { if (!c) return; c.classList.remove("lit"); if (lit === c) lit = null; };
  if (!reduce) {
    document.addEventListener("pointermove", (e) => {
      const c = e.target.closest?.(".card.lift");
      if (lit && lit !== c) off(lit);
      if (!c) return;
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      c.style.setProperty("--mx", x + "px"); c.style.setProperty("--my", y + "px");
      if (c.classList.contains("acard")) {
        const dx = x / r.width - .5, dy = y / r.height - .5; // -0.5 … 0.5
        c.style.setProperty("--tx", (-dy).toFixed(3)); c.style.setProperty("--ty", dx.toFixed(3));
        c.style.setProperty("--ta", (Math.hypot(dx, dy) * 12).toFixed(2) + "deg"); // up to ~8.5°
      }
      c.classList.add("lit"); lit = c;
    }, { passive: true });
    document.addEventListener("pointerout", (e) => { const c = e.target.closest?.(".card.lift"); if (c && !c.contains(e.relatedTarget)) off(c); }, { passive: true });
    document.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse" && lit) { const c = lit; setTimeout(() => off(c), 350); } }, { passive: true });
    document.addEventListener("scroll", () => off(lit), { passive: true, capture: true });
  }

  /* 7. Reveal on scroll: only what is below the fold when a view opens */
  let io = null;
  function reveal(viewEl) {
    if (!viewEl) return;
    viewEl.querySelectorAll(".fx-rv").forEach((el) => el.classList.remove("fx-rv", "fx-in"));
    if (reduce || !("IntersectionObserver" in window)) return;
    io = io || new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("fx-in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -6% 0px", threshold: 0.12 });
    const fold = innerHeight * 0.96;
    let n = 0;
    viewEl.querySelectorAll(".bento-item, .acard").forEach((el) => {
      if (el.closest(".fx-rv")) return; // parent already waits
      const top = el.getBoundingClientRect().top;
      if (top > fold) { el.style.setProperty("--rvd", (n++ % 3) * 70 + "ms"); el.classList.add("fx-rv"); io.observe(el); }
    });
  }

  window.UGFx = { reveal, reduce };
})();
