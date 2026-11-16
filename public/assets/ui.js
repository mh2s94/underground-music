// UNDERGROUND — shared UI helpers: toasts, reveal-on-scroll, escaping.
(function () {
  const ICONS = {
    success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warning: '<path d="M12 8v5"/><path d="M12 16.5v.5"/><path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5v.5"/>'
  };
  const svg = (inner, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let host;
  function toast(type, title, msg = "", { duration = 5000 } = {}) {
    if (!host) {
      host = document.createElement("div");
      host.className = "toasts";
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML =
      `<div class="toast-icon">${svg(ICONS[type] || ICONS.info)}</div>` +
      `<div class="toast-body"><div class="toast-title">${esc(title)}</div>${msg ? `<div class="toast-msg">${esc(msg)}</div>` : ""}</div>` +
      `<button class="toast-close" type="button" aria-label="Dismiss">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 16)}</button>` +
      `<div class="toast-bar" style="animation-duration:${duration}ms"></div>`;
    const close = () => {
      if (el.classList.contains("leaving")) return;
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector(".toast-close").onclick = close;
    el.querySelector(".toast-bar").addEventListener("animationend", close);
    host.appendChild(el);
    while (host.children.length > 4) host.firstElementChild.remove();
    return close;
  }

  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }, { rootMargin: "0px 0px -8% 0px" })
    : null;
  function reveal(root = document) {
    root.querySelectorAll(".reveal:not(.in)").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }

  window.UI = { toast, reveal, shake, esc, svg, ICONS };
})();
