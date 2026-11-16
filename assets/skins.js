/* Preview only: switch between the 10 login/profile designs (assets/skins.css). Not loaded on music.mikasa.me. */
(() => {
  if (location.hostname === "music.mikasa.me") return;
  const NAMES = { "01": "Backstage Pass", "02": "Gig Ticket", "03": "Photocopy Zine", "04": "Amp Head", "05": "Cassette",
    "06": "Terminal", "07": "Neon Brick", "08": "Vinyl Sleeve", "09": "Frosted Glass", "10": "Battle Jacket" };
  let id = new URLSearchParams(location.search).get("skin");
  if (!NAMES[id]) { try { id = localStorage.getItem("ug_skin"); } catch (e) { id = null; } }
  if (!NAMES[id]) id = "01";
  document.body.dataset.skin = id;
  window.UGSkin = { demo: false };

  const bar = document.createElement("div");
  bar.className = "sk-pick";
  bar.innerHTML = `<b>AKUN</b><select aria-label="Desain login & profil">${Object.entries(NAMES).map(([k, v]) => `<option value="${k}"${k === id ? " selected" : ""}>${k} ${v}</option>`).join("")}</select>
    <button type="button" data-m="login" aria-pressed="true">Login</button><button type="button" data-m="profile" aria-pressed="false">Profil</button>`;
  const show = () => window.UGAccount && window.UGAccount();
  bar.querySelector("select").addEventListener("change", (e) => {
    id = e.target.value; document.body.dataset.skin = id;
    try { localStorage.setItem("ug_skin", id); } catch (err) { /* private mode */ }
    show();
  });
  bar.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
    window.UGSkin.demo = b.dataset.m === "profile";
    bar.querySelectorAll("[data-m]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    show();
  }));
  document.addEventListener("DOMContentLoaded", () => document.body.append(bar));
})();
