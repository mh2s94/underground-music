// UNDERGROUND — bento dashboard (public site)
(() => {
  "use strict";

  // ---- Config -------------------------------------------------------------
  const SUPABASE_URL = "https://lhhmzfwjznlwkentbakv.supabase.co";
  const SUPABASE_KEY = "sb_publishable_MQDqmSmPb3qiSODbBOSKmA_U7aBEFtN";
  // Where "Submit your demo" and "Contact" send people. Leave empty to show a "coming soon" note.
  const SUBMIT_EMAIL = "";

  const GENRES = ["Metalcore", "Deathcore", "Hardcore", "Darkcore", "Post-Hardcore", "Black Metal", "Djent", "Underground"];
  const WARM = new Set(["deathcore", "hardcore", "darkcore", "black metal"]);
  const GENRE_COLOR = {
    Metalcore: "#40A887", Djent: "#62C3A5", "Post-Hardcore": "#9BD8C3", Underground: "#1B3C36",
    Deathcore: "#C68B59", Hardcore: "#E2A878", Darkcore: "#8A5A2E", "Black Metal": "#B9A08A"
  };
  const YT_LINE = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*$/m;
  const DAY = 864e5;

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const { esc, toast } = window.UI;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let articles = [];
  let genre = "All";
  let view = "home";
  let weekOffset = 0;
  let lastFocus = null;

  // ---- Helpers ------------------------------------------------------------
  const isWarm = (g) => WARM.has(String(g || "").toLowerCase());
  const tagHtml = (g) => `<span class="tag${isWarm(g) ? " warm" : ""}">${esc(g || "Underground")}</span>`;
  const ytId = (s) => (String(s || "").match(YT_LINE) || [])[1] || "";
  const readTime = (s) => Math.max(1, Math.round((String(s || "").match(/\S+/g) || []).length / 220)) + " min read";
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const keyOf = (a) => encodeURIComponent(a.slug || a.id);
  const nf = new Intl.NumberFormat("en-US");
  function timeAgo(d) {
    const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.round(s / 86400) + " d ago";
    return fmtDate(d);
  }
  const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // Deterministic pseudo-random from a string seed
  function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5 | 0, (((s ^ (s >>> 7)) >>> 0) % 10000) / 10000)); }

  // Abstract 3D-style cover art (emerald / sage / terracotta), unique per article
  let artN = 0;
  function art(seed) {
    const r = rng(hash(seed));
    const id = "a" + (++artN);
    const bgs = ["#E6F2EC", "#F3ECE3", "#E1EEE9", "#EDF1EA", "#F1E9E1"];
    const bg = bgs[Math.floor(r() * bgs.length)];
    const sx = 90 + r() * 160, sy = 110 + r() * 80, sr = 46 + r() * 30;
    const cx = 200 + r() * 140, cy = 70 + r() * 120, cs = 64 + r() * 40, rot = -25 + r() * 50;
    const tx = 60 + r() * 280, ty = 40 + r() * 80, tr = 30 + r() * 26;
    const px = 40 + r() * 260, py = 190 + r() * 50;
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs>
<radialGradient id="${id}s" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#C9F5E4"/><stop offset=".45" stop-color="#62C3A5"/><stop offset="1" stop-color="#1B3C36"/></radialGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6D7B6"/><stop offset=".55" stop-color="#E2A878"/><stop offset="1" stop-color="#9C643A"/></linearGradient>
<linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9BD8C3"/><stop offset="1" stop-color="#2E7D66"/></linearGradient>
<linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1B3C36"/><stop offset="1" stop-color="#40A887"/></linearGradient>
<filter id="${id}b"><feGaussianBlur stdDeviation="9"/></filter>
</defs>
<rect width="400" height="300" fill="${bg}"/>
<circle cx="${(sx + 220) % 400}" cy="${(sy + 140) % 300}" r="120" fill="#ffffff" opacity=".45"/>
<ellipse cx="${sx}" cy="${sy + sr + 10}" rx="${sr * .9}" ry="10" fill="#132B27" opacity=".18" filter="url(#${id}b)"/>
<ellipse cx="${cx}" cy="${cy + cs * .75}" rx="${cs * .6}" ry="9" fill="#132B27" opacity=".15" filter="url(#${id}b)"/>
<rect x="${px}" y="${py}" width="${110 + r() * 60}" height="26" rx="13" fill="url(#${id}p)" opacity=".9"/>
<circle cx="${tx}" cy="${ty}" r="${tr}" fill="none" stroke="url(#${id}t)" stroke-width="${12 + r() * 6}"/>
<g transform="rotate(${rot} ${cx} ${cy})"><rect x="${cx - cs / 2}" y="${cy - cs / 2}" width="${cs}" height="${cs}" rx="${cs * .22}" fill="url(#${id}c)"/><rect x="${cx - cs / 2 + 8}" y="${cy - cs / 2 + 7}" width="${cs * .45}" height="${cs * .2}" rx="${cs * .1}" fill="#fff" opacity=".35"/></g>
<circle cx="${sx}" cy="${sy}" r="${sr}" fill="url(#${id}s)"/>
<ellipse cx="${sx - sr * .35}" cy="${sy - sr * .4}" rx="${sr * .28}" ry="${sr * .16}" fill="#fff" opacity=".55"/>
</svg>`;
  }

  // Soundwave line-art
  function wave(el, w, h, lines = 7) {
    let out = "";
    for (let k = 0; k < lines; k++) {
      const amp = 18 + k * 9, freq = 1.4 + k * .18, phase = k * .7, mid = h * (.35 + k * .05);
      let d = "";
      for (let x = 0; x <= w; x += 10) {
        const env = Math.sin((x / w) * Math.PI);
        const y = mid + Math.sin((x / w) * Math.PI * 2 * freq + phase) * amp * env;
        d += (x ? "L" : "M") + x + " " + y.toFixed(1);
      }
      const col = k % 3 === 2 ? "rgba(226,168,120,.7)" : "rgba(98,195,165,.75)";
      out += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${k % 3 === 0 ? 2 : 1.2}" style="animation-delay:${k * 90}ms"/>`;
    }
    el.innerHTML = out;
  }

  // Markdown → HTML (escaped first)
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  const ytEmbed = (id) => `<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video player" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  function md(src, skip) {
    let html = "", para = [], list = false;
    const flush = () => { if (para.length) { html += "<p>" + inline(para.join(" ")) + "</p>"; para = []; } };
    const endList = () => { if (list) { html += "</ul>"; list = false; } };
    for (const raw of esc(src).split("\n")) {
      const l = raw.trim(); let m;
      if (!l) { flush(); endList(); continue; }
      if ((m = l.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})\S*$/))) { flush(); endList(); if (m[1] !== skip) html += ytEmbed(m[1]); continue; }
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flush(); endList(); const t = m[1].length === 3 ? "h3" : "h2"; html += `<${t}>${inline(m[2])}</${t}>`; continue; }
      if ((m = l.match(/^&gt;\s?(.*)$/))) { flush(); endList(); html += "<blockquote>" + inline(m[1]) + "</blockquote>"; continue; }
      if ((m = l.match(/^[-*•]\s+(.*)$/))) { flush(); if (!list) { html += "<ul>"; list = true; } html += "<li>" + inline(m[1]) + "</li>"; continue; }
      endList(); para.push(l);
    }
    flush(); endList();
    return html;
  }

  // ---- Data-derived numbers ----------------------------------------------
  function weekly(n) {
    const start = startOfWeek(new Date());
    const weeks = Array.from({ length: n }, (_, i) => {
      const from = new Date(start.getTime() - (n - 1 - i) * 7 * DAY);
      return { from, to: new Date(from.getTime() + 7 * DAY), mint: 0, warm: 0 };
    });
    for (const a of articles) {
      const t = new Date(a.published_at);
      const w = weeks.find((x) => t >= x.from && t < x.to);
      if (w) isWarm(a.genre) ? w.warm++ : w.mint++;
    }
    return weeks;
  }
  function barsHtml(weeks) {
    const max = Math.max(1, ...weeks.map((w) => w.mint + w.warm));
    return weeks.map((w, i) => {
      const total = w.mint + w.warm;
      const label = w.from.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      if (!total) return `<div class="bar-col"><div class="bar empty" data-h="4" style="--b:${i}"></div><small>${label.split(" ")[0]}</small></div>`;
      return `<div class="bar-col" title="${total} ${total === 1 ? "story" : "stories"} · week of ${label}">
        <div class="bar" data-h="${Math.round((total / max) * 100)}" data-v="${total}" style="--b:${i};display:flex;flex-direction:column;background:none;gap:2px">
          ${w.warm ? `<span style="flex:${w.warm};background:var(--amber);border-radius:8px"></span>` : ""}
          ${w.mint ? `<span style="flex:${w.mint};background:var(--mint);border-radius:8px"></span>` : ""}
        </div><small>${label.split(" ")[0]}</small></div>`;
    }).join("");
  }
  const bands = () => {
    const seen = new Map();
    for (const a of articles) {
      const name = (a.band_name || "").trim() || (a.title.includes(" — ") ? a.title.split(" — ")[0].trim() : "");
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, a });
    }
    return [...seen.values()];
  };
  const releases = () => new Set(articles.map((a) => (a.album_name || "").trim().toLowerCase()).filter(Boolean)).size;
  const coverOf = (a) => a.cover_image_url || (ytId(a.content) ? `https://i.ytimg.com/vi/${ytId(a.content)}/hqdefault.jpg` : "");

  // ---- Render: dashboard ---------------------------------------------------
  function renderHome() {
    const now = Date.now();
    const bl = bands().slice(0, 6);
    $("avatars").innerHTML = bl.length ? bl.map(({ name, a }) => {
      const img = coverOf(a);
      const fresh = now - new Date(a.published_at) < 14 * DAY;
      const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      return `<a class="avatar" href="#/a/${keyOf(a)}" title="${esc(name)}"><span class="ring"><span class="face">${esc(initials)}${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>${fresh ? '<span class="status" aria-label="New"></span>' : ""}</span><span class="name">${esc(name)}</span></a>`;
    }).join("") : `<div class="empty-note" style="width:100%">Bands appear here as stories are published.</div>`;

    $("kpi30").dataset.count = articles.filter((a) => now - new Date(a.published_at) < 30 * DAY).length;
    $("activityBars").innerHTML = barsHtml(weekly(8));
    $("statArticles").dataset.count = articles.length;
    $("statReleases").dataset.count = releases();

    renderCalendar();

    const vids = articles.filter((a) => ytId(a.content)).slice(0, 4);
    $("sessions").innerHTML = vids.length ? vids.map((a) => `
      <a class="session" href="#/a/${keyOf(a)}">
        ${art(a.id)}<img src="https://i.ytimg.com/vi/${ytId(a.content)}/hqdefault.jpg" alt="" loading="lazy" onerror="this.remove()">
        <span class="shade"></span><span class="play" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg></span>
        <span class="cap">${esc(a.title)}</span></a>`).join("")
      : `<div class="empty-note" style="grid-column:1/-1">Music videos from new stories show up here.</div>`;
    $("sessions").querySelectorAll("svg").forEach((s) => s.classList.add("art"));

    const icoReview = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
    $("wire").innerHTML = articles.length ? articles.slice(0, 6).map((a) => `
      <li><a href="#/a/${keyOf(a)}"><span class="ico${isWarm(a.genre) ? " warm" : ""}">${icoReview}</span>
      <span style="min-width:0"><div class="t">${esc(a.title)}</div><div class="time">${esc(a.genre || "Underground")} · ${timeAgo(a.published_at)}</div></span></a></li>`).join("")
      : `<li><div class="empty-note">No updates yet.</div></li>`;
  }

  function renderCalendar() {
    const start = new Date(startOfWeek(new Date()).getTime() + weekOffset * 7 * DAY);
    const mid = new Date(start.getTime() + 3 * DAY);
    $("calTitle").textContent = mid.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const today = new Date();
    let count = 0;
    $("calDays").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY);
      const has = articles.some((a) => sameDay(new Date(a.published_at), d));
      if (has) count++;
      return `<div class="day${sameDay(d, today) ? " today" : ""}${has ? " has" : ""}"><small>${d.toLocaleDateString("en-GB", { weekday: "short" })}</small>${d.getDate()}</div>`;
    }).join("");
    $("calNote").textContent = count ? `New stories on ${count} ${count === 1 ? "day" : "days"} this week.` : "No new stories this week yet.";
  }
  $("calPrev").onclick = () => { weekOffset--; renderCalendar(); };
  $("calNext").onclick = () => { weekOffset++; renderCalendar(); };

  // ---- Render: articles ----------------------------------------------------
  function renderPills() {
    $("pills").innerHTML = ["All", ...GENRES].map((g) => `<button class="pill" type="button" aria-pressed="${g === genre}" data-g="${esc(g)}">${esc(g)}</button>`).join("");
  }
  $("pills").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    genre = b.dataset.g; renderPills(); renderGrid(true);
  });

  function renderCoverage() {
    const counts = GENRES.map((g) => ({ g, n: articles.filter((a) => (a.genre || "Underground").toLowerCase() === g.toLowerCase()).length })).filter((x) => x.n);
    const total = counts.reduce((s, x) => s + x.n, 0);
    $("covTotal").textContent = total ? `${total} ${total === 1 ? "story" : "stories"}` : "";
    $("covBar").innerHTML = counts.map((x, i) => `<span data-w="${(x.n / total) * 100}" style="--b:${i};background:${GENRE_COLOR[x.g]}" title="${esc(x.g)}: ${x.n}"></span>`).join("");
    $("covLegend").innerHTML = counts.length
      ? counts.map((x) => `<div><span><i style="background:${GENRE_COLOR[x.g]}"></i>${esc(x.g)}</span><b>${Math.round((x.n / total) * 100)}%</b></div>`).join("")
      : `<div style="grid-column:1/-1">Coverage appears once stories are published.</div>`;
  }

  function renderGrid(animate) {
    const list = genre === "All" ? articles : articles.filter((a) => (a.genre || "Underground").toLowerCase() === genre.toLowerCase());
    $("grid").innerHTML = list.length ? list.map((a) => `
      <a class="card lift acard bento-item" href="#/a/${keyOf(a)}">
        <div class="art-wrap">${art(a.id)}${ytId(a.content) ? `<span class="vid"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>Video</span>` : ""}</div>
        <div class="body">${tagHtml(a.genre)}<h3>${esc(a.title)}</h3>${a.excerpt ? `<p>${esc(a.excerpt)}</p>` : ""}
          <div class="meta"><span>${fmtDate(a.published_at)}</span><span>${readTime(a.content)}</span></div></div>
      </a>`).join("")
      : `<div class="card pad bento-item" style="grid-column:1/-1"><div class="empty-note">${articles.length ? `No ${esc(genre)} stories yet.` : "No published stories yet. New coverage is on the way."}</div></div>`;
    if (animate) stagger($("grid"), 0);
  }

  // ---- Render: about -------------------------------------------------------
  function renderAbout() {
    $("kpiReviews").dataset.count = articles.length;
    $("kpiBands").dataset.count = bands().length;
    $("radarBars").innerHTML = barsHtml(weekly(12));
  }

  // ---- Motion --------------------------------------------------------------
  function stagger(root, offset = 0) {
    const items = root.querySelectorAll(".bento-item");
    items.forEach((el, i) => el.style.setProperty("--i", offset + i));
    const host = root.closest(".view") || root;
    if (root !== host) {
      items.forEach((el) => { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; });
    }
  }
  function countUp(root) {
    root.querySelectorAll("[data-count]").forEach((el) => {
      const target = Number(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || "";
      if (reduceMotion || !target) { el.textContent = nf.format(target) + suffix; return; }
      const t0 = performance.now(), dur = 1300;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(2, -10 * p);
        el.textContent = nf.format(Math.round(target * (p >= 1 ? 1 : e))) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function grow(root) {
    root.querySelectorAll("[data-h]").forEach((el) => { el.style.height = "0"; });
    root.querySelectorAll("[data-w]").forEach((el) => { el.style.width = "0"; });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll("[data-h]").forEach((el) => { el.style.height = el.dataset.h + "%"; });
      root.querySelectorAll("[data-w]").forEach((el) => { el.style.width = el.dataset.w + "%"; });
    }));
  }
  function enter(viewEl) {
    viewEl.classList.remove("entered");
    stagger(viewEl);
    void viewEl.offsetWidth;
    viewEl.classList.add("entered");
    setTimeout(() => { countUp(viewEl); grow(viewEl); }, 180);
  }

  // ---- Views & routing -----------------------------------------------------
  function movePill() {
    const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
    if (btn) $("navPill").style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
  }
  function showView(name) {
    if (!["home", "articles", "about"].includes(name)) name = "home";
    const changed = name !== view || !document.querySelector(".view.entered");
    view = name;
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll(".nav-btn").forEach((b) => { if (b.dataset.view === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    movePill();
    if (changed) { $("main").scrollTop = 0; enter($("view-" + name)); }
  }
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => { location.hash = "/" + b.dataset.view; }));
  window.addEventListener("resize", movePill);

  function route() {
    const h = location.hash;
    const m = h.match(/^#\/a\/(.+)$/);
    if (m) { if (!document.querySelector(".view.entered")) showView(view); openArticle(decodeURIComponent(m[1])); return; }
    closeReader(true);
    const v = (h.match(/^#\/(\w+)/) || [])[1];
    showView(v || "home");
  }
  window.addEventListener("hashchange", route);

  // ---- Reader --------------------------------------------------------------
  async function openArticle(key) {
    let a = articles.find((x) => x.slug === key || String(x.id) === key);
    if (!a) {
      const q = db.from("articles").select("id,slug,title,excerpt,content,cover_image_url,genre,tags,published_at,band_name,album_name").eq("status", "published");
      const { data } = await (/^[0-9a-f-]{36}$|^\d+$/i.test(key) ? q.eq("id", key) : q.eq("slug", key)).maybeSingle();
      a = data;
    }
    if (!a) { toast("warning", "Story not found", "It may have been moved or unpublished."); location.hash = "/" + view; return; }
    const vid = ytId(a.content);
    $("readerTag").innerHTML = tagHtml(a.genre);
    $("readerBody").innerHTML = `
      <div class="reader-hero">${art(a.id)}</div>
      <div class="meta-row"><span>${fmtDate(a.published_at)}</span><span aria-hidden="true">·</span><span>${readTime(a.content)}</span>${a.band_name ? `<span aria-hidden="true">·</span><span>${esc(a.band_name)}</span>` : ""}</div>
      <h1 id="readerTitle">${esc(a.title)}</h1>
      ${a.excerpt ? `<p class="lede">${esc(a.excerpt)}</p>` : ""}
      ${vid ? ytEmbed(vid) : ""}
      <div class="prose">${md(a.content, vid)}</div>
      ${Array.isArray(a.tags) && a.tags.length ? `<div class="tags">${a.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>` : ""}`;
    document.title = a.title + " — UNDERGROUND";
    if ($("reader").hidden) { lastFocus = document.activeElement; $("reader").hidden = false; document.body.classList.add("locked"); }
    const sheet = $("reader").querySelector(".reader-sheet");
    sheet.scrollTop = 0; $("readerProgress").style.width = "0";
    sheet.focus({ preventScroll: true });
  }
  function closeReader(silent) {
    if ($("reader").hidden) return;
    $("reader").hidden = true;
    document.body.classList.remove("locked");
    document.title = "UNDERGROUND — Independent Extreme Music Magazine";
    if (!silent && location.hash.startsWith("#/a/")) location.hash = "/" + view;
    lastFocus?.focus?.();
  }
  $("reader").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeReader(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("reader").hidden) closeReader(); });
  $("reader").querySelector(".reader-sheet").addEventListener("scroll", (e) => {
    const s = e.currentTarget, max = s.scrollHeight - s.clientHeight;
    $("readerProgress").style.width = (max > 0 ? (s.scrollTop / max) * 100 : 0) + "%";
  }, { passive: true });
  $("shareBtn").onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: document.title, url: location.href });
      else { await navigator.clipboard.writeText(location.href); toast("success", "Link copied", "Share it anywhere."); }
    } catch (e) { if (e?.name !== "AbortError") toast("warning", "Could not copy the link", location.href); }
  };

  // ---- Buttons -------------------------------------------------------------
  $("readLatest").onclick = () => { if (articles[0]) location.hash = "/a/" + keyOf(articles[0]); else toast("info", "No stories yet", "The first articles are on their way."); };
  document.querySelectorAll("[data-demo]").forEach((b) => b.onclick = () => {
    if (SUBMIT_EMAIL) location.href = `mailto:${SUBMIT_EMAIL}?subject=${encodeURIComponent("Demo submission: [Band name]")}&body=${encodeURIComponent("Band:\nCountry:\nGenre:\nLink:\nTwo lines about the music:\n")}`;
    else toast("info", "Demo submissions open soon", "Follow the magazine for the submission address.");
  });
  document.querySelectorAll("[data-contact]").forEach((b) => b.onclick = () => {
    if (SUBMIT_EMAIL) location.href = `mailto:${SUBMIT_EMAIL}`;
    else toast("info", "Contact details coming soon");
  });

  // ---- Boot ----------------------------------------------------------------
  function skeletons() {
    $("grid").innerHTML = Array.from({ length: 4 }, () => `<div class="card" aria-hidden="true" style="overflow:hidden"><div class="skel" style="aspect-ratio:4/3;border-radius:0"></div><div style="padding:16px;display:flex;flex-direction:column;gap:10px"><div class="skel" style="height:20px;width:40%"></div><div class="skel" style="height:18px"></div><div class="skel" style="height:12px;width:80%"></div></div></div>`).join("");
  }
  async function load() {
    const { data, error } = await db.from("articles")
      .select("id,slug,title,excerpt,content,cover_image_url,genre,tags,published_at,band_name,album_name")
      .eq("status", "published").order("published_at", { ascending: false }).limit(60);
    if (error) toast("error", "Could not load stories", "Check your connection and refresh the page.");
    articles = (data || []).filter((a) => a.published_at);
  }
  function hideSplash() {
    const s = $("splash"); if (!s || s.classList.contains("out")) return;
    s.classList.add("out");
    setTimeout(() => s.remove(), 750);
  }

  wave($("heroWave"), 600, 320, 7);
  wave($("aboutWave"), 600, 180, 6);
  renderPills(); skeletons();
  const minSplash = new Promise((r) => setTimeout(r, reduceMotion ? 0 : 900));
  const maxSplash = setTimeout(hideSplash, 3000);
  Promise.all([load(), minSplash]).then(() => {
    clearTimeout(maxSplash);
    renderHome(); renderCoverage(); renderGrid(false); renderAbout();
    hideSplash();
    route();
  });
})();
