/* Preview only: compare how the sign-in / create-account form opens (style 04 Amp Head). Not loaded on music.mikasa.me. */
(() => {
  if (location.hostname === "music.mikasa.me") return;
  const MODES = { page: "1 Halaman baru", inplace: "2 Panel membuka", sheet: "3 Laci dari bawah", flip: "4 Panel berputar", slide: "5 Rack geser" };
  let mode = new URLSearchParams(location.search).get("form");
  if (!MODES[mode]) { try { mode = localStorage.getItem("ug_form"); } catch (e) { mode = null; } }
  if (!MODES[mode]) mode = "page";
  document.body.dataset.skin = "04";
  window.UGSkin = { demo: false };
  window.UGAuthMode = () => mode;

  const bar = document.createElement("div");
  bar.className = "sk-pick";
  bar.innerHTML = `<b>FORM</b><select aria-label="Cara form muncul">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${k === mode ? " selected" : ""}>${v}</option>`).join("")}</select>
    <button type="button" data-m="login" aria-pressed="true">Login</button><button type="button" data-m="profile" aria-pressed="false">Profil</button>`;
  const show = () => {
    if (location.hash.startsWith("#/account/")) { location.hash = "/account"; setTimeout(() => window.UGAccount && window.UGAccount(), 30); }
    else if (window.UGAccount) window.UGAccount();
  };
  bar.querySelector("select").addEventListener("change", (e) => {
    mode = e.target.value;
    try { localStorage.setItem("ug_form", mode); } catch (err) { /* private mode */ }
    show();
  });
  bar.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
    window.UGSkin.demo = b.dataset.m === "profile";
    bar.querySelectorAll("[data-m]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    show();
  }));
  document.addEventListener("DOMContentLoaded", () => document.body.append(bar));
})();
