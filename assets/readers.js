// Footer "Where our readers are": share of page views per country (style B).
// Data: /api/readers (Cloudflare Web Analytics, percentages only).
// The box stays hidden if the endpoint is not configured or has too little data.
(() => {
  const box = document.getElementById("ftReaders");
  if (!box || !("fetch" in window)) return;
  const COLORS = ["var(--neon)", "var(--uv-hi)", "var(--uv)", "var(--neon-hi)", "#5B44C9", "var(--line-2)"];
  let names = null;
  try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch {}
  const label = (code) => code === "other" ? "Other countries" : (names && /^[A-Z]{2}$/.test(code) ? (names.of(code) || code) : code);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const load = async () => {
    let d;
    try { d = await (await fetch("/api/readers")).json(); } catch { return; }
    if (!d || !d.ok || !Array.isArray(d.countries) || !d.countries.length) return;
    const rows = d.countries.map((c, i) => ({ name: label(c.code), pct: Number(c.pct) || 0, color: c.code === "other" ? COLORS[5] : COLORS[i % 5] }));
    const strip = document.getElementById("rcStrip");
    strip.innerHTML = rows.map((r) => `<div class="rc-seg" style="background:${r.color}" data-w="${r.pct}" title="${esc(r.name)} ${r.pct}%"></div>`).join("");
    strip.setAttribute("aria-label", rows.map((r) => `${r.name} ${r.pct}%`).join(", "));
    document.getElementById("rcLegend").innerHTML = rows.map((r) => `<li><span class="rc-sw" style="background:${r.color}"></span>${esc(r.name)} <b>${r.pct}%</b></li>`).join("");
    if (d.days) document.getElementById("rcDays").textContent = `Last ${Number(d.days)} days`;
    box.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => strip.querySelectorAll(".rc-seg").forEach((s) => { s.style.width = s.dataset.w + "%"; })));
  };

  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { obs.disconnect(); load(); } }, { rootMargin: "300px" });
    obs.observe(document.getElementById("siteFooter") || box);
  } else load();
})();
