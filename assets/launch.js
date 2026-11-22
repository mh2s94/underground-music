/* UNDERGROUND — launch motion 10 "Signal Sweep" (see launch.css).
   Plays once per browser session: the sessionStorage key "ug_launch_seen" is written on the first
   open, so reloads and in-session navigation go straight to the content. UGLaunch.intro(splashEl)
   runs the first-open overlay; UGLaunch.view(viewEl) is the short page-change hand-off. Off for
   prefers-reduced-motion (the overlay is never built and the splash just fades). */
(() => {
  const ID = "10", INTRO_MS = 1250, SEEN = "ug_launch_seen";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timer = 0;
  if (!reduce) document.body.dataset.lm = ID;

  const alreadySeen = () => { try { return sessionStorage.getItem(SEEN) === "1"; } catch (e) { return false; } };
  const markSeen = () => { try { sessionStorage.setItem(SEEN, "1"); } catch (e) { /* private mode: play again next time */ } };

  const LOGO = '<div class="lm-logo"><svg class="glitch-wave-mark" width="128" height="80" viewBox="0 0 64 40" fill="none" role="img" aria-hidden="true" focusable="false"><path d="M2 20h7l5-11 7 22 7-17 6 10 7-16 7 24 6-12h10" stroke="currentColor" stroke-width="3.2" stroke-linecap="square" stroke-linejoin="miter"/></svg></div>';
  const WORD = '<div class="lm-word" aria-hidden="true">UNDERGROUND</div>';

  // Repeat open in the same session: skip the overlay and take the static splash away immediately,
  // before the app finishes booting, so reloads feel instant.
  const seen = alreadySeen();
  if (seen) {
    document.documentElement.classList.add("launch-done");
    const s = document.getElementById("splash"); if (s) s.remove();
  }

  window.UGLaunch = {
    intro(splash) {
      if (splash) splash.remove();
      if (reduce) return;
      clearTimeout(timer);
      document.body.classList.add("lm-intro");
      if (seen) { document.body.classList.remove("lm-intro"); return; } // already greeted this session
      markSeen();
      const el = document.createElement("div");
      el.id = "lm"; el.className = "m" + ID; el.setAttribute("aria-hidden", "true");
      el.innerHTML = LOGO + WORD;
      document.body.append(el);
      setTimeout(() => el.remove(), INTRO_MS);
      timer = setTimeout(() => document.body.classList.remove("lm-intro"), INTRO_MS);
    },
    // Page-change hand-off: the incoming view settles in with a quick fade.
    view(viewEl) {
      if (reduce || !viewEl) return;
      viewEl.classList.remove("lm-view-in");
      void viewEl.offsetWidth;
      viewEl.classList.add("lm-view-in");
    },
  };
})();
