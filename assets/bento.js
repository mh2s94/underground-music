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
    Metalcore: "#7B5CFF", Djent: "#A48FFF", "Post-Hardcore": "#4F7BFF", Underground: "#C9C2E8",
    Deathcore: "#FF2E63", Hardcore: "#FF5C86", Darkcore: "#B3124A", "Black Metal": "#FF9BB5"
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

  // Deterministic pseudo-random from a string seed
  function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5 | 0, (((s ^ (s >>> 7)) >>> 0) % 10000) / 10000)); }

  // Neon cover art: glowing tubes, rings and a perspective floor, unique per article
  let artN = 0;
  function art(seed) {
    const r = rng(hash(seed));
    const id = "a" + (++artN);
    const flip = r() > .5;
    const c1 = flip ? "#FF2E63" : "#7B5CFF", c2 = flip ? "#7B5CFF" : "#FF2E63";
    const rx = 120 + r() * 160, ry = 70 + r() * 70, rr = 46 + r() * 34;
    const tx = 40 + r() * 140, ty = 40 + r() * 60, tw = 140 + r() * 120, rot = -20 + r() * 40;
    const hz = 175 + r() * 30;
    let floor = "";
    for (let i = 0; i < 9; i++) { const x = -200 + i * 100; floor += `<path d="M200 ${hz} L${x} 300"/>`; }
    for (let j = 1; j < 6; j++) { const y = hz + Math.pow(j / 5, 1.8) * (300 - hz); floor += `<path d="M0 ${y.toFixed(1)} H400"/>`; }
    return `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs>
<filter id="${id}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="${id}h" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="${c2}" stop-opacity=".35"/><stop offset="1" stop-color="#07060B" stop-opacity="0"/></radialGradient>
</defs>
<rect width="400" height="300" fill="#07060B"/>
<rect width="400" height="300" fill="url(#${id}h)"/>
<g stroke="${c2}" stroke-width="1" opacity=".45" fill="none">${floor}</g>
<circle cx="${rx}" cy="${ry}" r="${rr}" fill="none" stroke="${c1}" stroke-width="5" filter="url(#${id}g)"/>
<circle cx="${rx}" cy="${ry}" r="${rr}" fill="none" stroke="#FFE3EC" stroke-width="1.4"/>
<g transform="rotate(${rot} ${tx + tw / 2} ${ty})"><rect x="${tx}" y="${ty - 5}" width="${tw}" height="10" rx="5" fill="${c2}" filter="url(#${id}g)"/><rect x="${tx + 3}" y="${ty - 1.5}" width="${tw - 6}" height="3" rx="1.5" fill="#F2EEFF"/></g>
<path d="M0 ${hz} H400" stroke="${c1}" stroke-width="2" filter="url(#${id}g)" opacity=".85"/>
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
      const col = k % 3 === 2 ? "rgba(255,46,99,.75)" : "rgba(123,92,255,.7)";
      out += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${k % 3 === 0 ? 2 : 1.2}" style="animation-delay:${k * 90}ms"/>`;
    }
    el.innerHTML = out;
  }

  // Hero: perspective dance-floor grid + live REC timer
  function heroFloor(el) {
    const hz = 230; let d = "";
    for (let i = 0; i <= 16; i++) d += `<path d="M400 ${hz} L${-400 + i * 100} 360"/>`;
    for (let j = 1; j <= 6; j++) { const y = hz + Math.pow(j / 6, 1.7) * (360 - hz); d += `<path d="M0 ${y.toFixed(1)} H800"/>`; }
    el.innerHTML = `<g fill="none" stroke="#7B5CFF" stroke-width="1">${d}</g><path d="M0 ${hz} H800" stroke="#FF2E63" stroke-width="1.5" style="filter:drop-shadow(0 0 6px #FF2E63)"/>`;
  }
  function recTimer() {
    const el = document.getElementById("recTime"); if (!el) return;
    const t0 = Date.now();
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":"); };
    tick(); setInterval(tick, 1000);
  }

  // Markdown → HTML (escaped first)
  const inline = (s) => s
    .replace(/\[([^\]]{1,200})\]\((https:\/\/[^\s)]{4,500})\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
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
          ${w.warm ? `<span data-c="neon" style="flex:${w.warm};background:var(--neon)"></span>` : ""}
          ${w.mint ? `<span data-c="uv" style="flex:${w.mint};background:var(--uv)"></span>` : ""}
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
  // Real cover when the article has one (cover URL or the band's YouTube thumbnail),
  // generated neon art underneath as the fallback if there is none or it fails to load.
  const media = (a) => {
    const img = coverOf(a);
    return art(a.id) + (img ? `<img class="cover" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "");
  };

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

  // ---- Scene radar: latest headlines from heavy-music sites -------------------
  async function loadNews() {
    try {
      const r = await fetch("/api/news", { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const { items = [] } = await r.json();
      if (!items.length) return;
      const ext = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';
      const icoNews = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5"/></svg>';
      $("wire").innerHTML = items.slice(0, 7).map((n) => {
        const g = (n.genres || [])[0];
        return `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer nofollow">
          <span class="ico${g && isWarm(g) ? " warm" : ""}">${icoNews}</span>
          <span style="min-width:0"><div class="t">${esc(n.title)}</div>
          <div class="time">${esc(n.source)}${g ? " · " + esc(g) : ""}${n.date ? " · " + timeAgo(n.date) : ""} ${ext}</div></span></a></li>`;
      }).join("");
      $("wireHint").textContent = "Live from the scene";
    } catch { /* keep our own stories in the wire */ }
  }


  // ---- Music: Basement radio + persistent mini player ----------------------
  let tracks = [];
  let musicGenre = "All";
  let queue = [], qi = -1;
  const audio = $("audio");
  const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
  const PLAY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
  const trackCover = (t) => t.cover_url
    ? `<img src="${esc(t.cover_url)}" alt="" loading="lazy" onerror="this.remove()">${art(t.id)}`
    : art(t.id);
  const filteredTracks = () => musicGenre === "All" ? tracks : tracks.filter((t) => (t.genre || "Underground").toLowerCase() === musicGenre.toLowerCase());

  async function loadTracks() {
    const q = (cols) => db.from("tracks").select(cols)
      .eq("status", "published").order("published_at", { ascending: false }).limit(300);
    let { data, error } = await q("id,title,artist,genre,album,release_year,cover_url,audio_url,duration_sec,published_at");
    if (error) ({ data, error } = await q("id,title,artist,genre,cover_url,audio_url,duration_sec,published_at")); // before music-v2.sql
    tracks = error ? [] : (data || []).filter((t) => /^https:\/\//i.test(t.audio_url || ""));
    renderMusicPills(); renderTrackList(); renderHomeTracks();
  }

  function renderMusicPills() {
    const present = new Set(tracks.map((t) => t.genre || "Underground"));
    const list = ["All", ...GENRES.filter((g) => present.has(g))];
    $("musicPills").innerHTML = list.map((g) => `<button class="pill" type="button" aria-pressed="${g === musicGenre}" data-mg="${esc(g)}">${esc(g)}</button>`).join("");
  }
  $("musicPills").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mg]"); if (!b) return;
    musicGenre = b.dataset.mg; renderMusicPills(); renderTrackList();
  });

  function rowHtml(t, i) {
    return `<li><button class="track" type="button" data-track="${esc(t.id)}" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}">
      <span class="tr-n">${String(i + 1).padStart(2, "0")}</span>${EQ}
      <span class="tr-cover">${trackCover(t)}<span class="tr-play" aria-hidden="true">${PLAY_SVG}</span></span>
      <span class="tr-meta"><span class="tr-title">${esc(t.title)}</span><span class="tr-artist">${esc(t.artist)}${t.album ? " · " + esc(t.album) : ""}${t.release_year ? " · " + esc(t.release_year) : ""}</span></span>
      ${tagHtml(t.genre || "Underground")}
      <span class="tr-dur">${t.duration_sec ? fmtTime(t.duration_sec) : ""}</span>
    </button></li>`;
  }
  function renderTrackList() {
    const list = filteredTracks();
    $("trackCount").textContent = tracks.length ? `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}` : "";
    $("playAll").disabled = $("shuffleAll").disabled = !list.length;
    $("trackList").innerHTML = list.length ? list.map(rowHtml).join("")
      : `<li><div class="empty-note">${tracks.length ? "No tracks in this genre yet." : "The radio is quiet for now. New tracks drop here as soon as the editors upload them."}</div></li>`;
    markPlaying();
  }
  function renderHomeTracks() {
    $("homeTracks").innerHTML = tracks.length ? tracks.slice(0, 4).map((t) => `
      <li><button class="mini-track" type="button" data-track="${esc(t.id)}" data-from="all" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}">
        <span class="tr-cover">${trackCover(t)}<span class="tr-play" aria-hidden="true">${PLAY_SVG}</span></span>
        <span class="tr-meta"><span class="tr-title">${esc(t.title)}</span><span class="tr-artist">${esc(t.artist)}</span></span>${EQ}
      </button></li>`).join("")
      : `<li><div class="empty-note">Tracks appear here when the editors upload music.</div></li>`;
    markPlaying();
  }

  function playFrom(list, i) {
    if (!list.length) return;
    queue = list.slice(); qi = Math.max(0, Math.min(i, queue.length - 1));
    const t = queue[qi];
    audio.src = t.audio_url;
    audio.play().catch(() => {});
    showPlayer(t);
  }
  function showPlayer(t) {
    $("player").hidden = false;
    document.body.classList.add("has-player");
    $("plTitle").textContent = t.title;
    $("plArtist").textContent = t.artist + (t.genre ? " · " + t.genre : "");
    $("plCover").innerHTML = trackCover(t);
    $("plCur").textContent = "0:00";
    $("plDur").textContent = t.duration_sec ? fmtTime(t.duration_sec) : "0:00";
    $("plSeek").value = 0;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: t.album || "UNDERGROUND · Basement radio",
        artwork: t.cover_url ? [{ src: t.cover_url, sizes: "600x600" }] : []
      });
    }
    markPlaying();
  }
  const current = () => (qi >= 0 ? queue[qi] : null);
  function step(dir) {
    if (!queue.length) return;
    if (dir < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
    qi = (qi + dir + queue.length) % queue.length;
    playFrom(queue, qi);
  }
  function togglePlay() {
    if (!current()) return playFrom(filteredTracks(), 0);
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function markPlaying() {
    const t = current();
    document.querySelectorAll("[data-track]").forEach((el) => {
      const on = !!t && el.dataset.track === String(t.id);
      el.classList.toggle("current", on);
      if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
    });
    const playing = !!t && !audio.paused;
    document.body.classList.toggle("is-playing", playing);
    $("plPlay").setAttribute("aria-label", playing ? "Pause" : "Play");
    $("plPlay").classList.toggle("paused", !playing);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-track]"); if (!b) return;
    const t = current();
    if (t && String(t.id) === b.dataset.track) { togglePlay(); return; }
    const list = b.dataset.from === "all" ? tracks : filteredTracks();
    playFrom(list, list.findIndex((x) => String(x.id) === b.dataset.track));
  });
  $("playAll").onclick = () => playFrom(filteredTracks(), 0);
  $("shuffleAll").onclick = () => {
    const l = filteredTracks().slice();
    for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
    playFrom(l, 0);
  };
  $("plPlay").onclick = togglePlay;
  $("plPrev").onclick = () => step(-1);
  $("plNext").onclick = () => step(1);
  $("plClose").onclick = () => {
    audio.pause(); audio.removeAttribute("src"); audio.load();
    queue = []; qi = -1;
    $("player").hidden = true; document.body.classList.remove("has-player");
    markPlaying();
  };
  let seeking = false;
  $("plSeek").addEventListener("input", () => {
    seeking = true;
    if (isFinite(audio.duration)) $("plCur").textContent = fmtTime($("plSeek").value / 1000 * audio.duration);
  });
  $("plSeek").addEventListener("change", () => {
    if (isFinite(audio.duration)) audio.currentTime = $("plSeek").value / 1000 * audio.duration;
    seeking = false;
  });
  let lastVol = 1;
  $("plVol").addEventListener("input", () => { audio.volume = +$("plVol").value; audio.muted = audio.volume === 0; $("player").classList.toggle("muted", audio.muted); });
  $("plMute").onclick = () => {
    if (audio.muted || audio.volume === 0) { audio.muted = false; audio.volume = lastVol || 1; }
    else { lastVol = audio.volume; audio.muted = true; }
    $("plVol").value = audio.muted ? 0 : audio.volume;
    $("player").classList.toggle("muted", audio.muted);
    $("plMute").setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
  };
  audio.addEventListener("timeupdate", () => {
    if (!isFinite(audio.duration) || seeking) return;
    $("plSeek").value = Math.round(audio.currentTime / audio.duration * 1000);
    $("plSeek").style.setProperty("--p", (audio.currentTime / audio.duration * 100) + "%");
    $("plCur").textContent = fmtTime(audio.currentTime);
  });
  audio.addEventListener("loadedmetadata", () => { if (isFinite(audio.duration)) $("plDur").textContent = fmtTime(audio.duration); });
  audio.addEventListener("play", markPlaying);
  audio.addEventListener("pause", markPlaying);
  audio.addEventListener("ended", () => { if (qi < queue.length - 1) step(1); else markPlaying(); });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    toast("warning", "This track can't be played", "Skipping to the next one.", { duration: 3500 });
    if (queue.length > 1) setTimeout(() => step(1), 800); else markPlaying();
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
  }

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
        <div class="art-wrap">${media(a)}${ytId(a.content) ? `<span class="vid"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>Video</span>` : ""}</div>
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
    if (!["home", "articles", "music", "about", "account"].includes(name)) name = "home";
    const changed = name !== view || !document.querySelector(".view.entered");
    view = name;
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll(".nav-btn").forEach((b) => { if (b.dataset.view === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    movePill();
    if (name === "account" && changed) renderAccount();
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
    currentArticle = a;
    updateSaveBtn();
    renderComments(a);
    const vid = ytId(a.content);
    $("readerTag").innerHTML = tagHtml(a.genre);
    $("readerBody").innerHTML = `
      ${vid ? "" : `<div class="reader-hero">${media(a)}</div>`}
      <div class="meta-row"><time datetime="${esc(a.published_at || "")}">${fmtDate(a.published_at)}${a.published_at ? ", " + new Date(a.published_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</time><span aria-hidden="true">·</span><span>${readTime(a.content)}</span>${a.band_name ? `<span aria-hidden="true">·</span><span>${esc(a.band_name)}</span>` : ""}</div>
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
    currentArticle = null;
    lastFocus?.focus?.();
  }
  $("reader").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeReader(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("demoModal").hidden) closeDemo();
    else if (!$("reader").hidden) closeReader();
  });
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
  document.querySelectorAll("[data-demo]").forEach((b) => b.onclick = () => openDemo());

  // ---- Footer ----------------------------------------------------------------
  $("ftYear").textContent = new Date().getFullYear();
  $("ftTop").onclick = () => $("main").scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  document.querySelectorAll("[data-ft-genre]").forEach((a) => a.addEventListener("click", () => {
    genre = a.dataset.ftGenre; renderPills(); renderGrid(true);
  }));
  if ("IntersectionObserver" in window) {
    const ftObs = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); ftObs.unobserve(e.target); }
    }), { root: $("main"), threshold: .15 });
    document.querySelectorAll(".ft-reveal").forEach((el) => ftObs.observe(el));
  } else document.querySelectorAll(".ft-reveal").forEach((el) => el.classList.add("in"));
  document.querySelectorAll("[data-contact]").forEach((b) => b.onclick = () => {
    if (SUBMIT_EMAIL) location.href = `mailto:${SUBMIT_EMAIL}`;
    else toast("info", "Contact details coming soon");
  });

  // ---- Community: accounts, saved articles, comments, demos ----------------
  let user = null, profile = null, isAdmin = false, recovery = false;
  let savedIds = new Set();
  let currentArticle = null;
  let authTab = "signin", pendingEmail = "";
  let demoLastFocus = null;
  const AUTH_REDIRECT = location.origin + "/?auth=1";
  const DEFAULT_ACCOUNT_ICON = $("accountIcon").innerHTML;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const initials = (n) => String(n || "").trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "U";
  const colorFor = (s) => ["#7B5CFF", "#FF2E63", "#4F2BB8", "#B3124A", "#5A3FD6", "#E0245A"][hash(s) % 6];
  const myName = () => profile?.display_name || user?.user_metadata?.display_name || (user?.email || "").split("@")[0] || "Reader";
  const notReady = (err) => !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST200" || /does not exist|schema cache|relationship/i.test(err.message || ""));
  function friendly(err) {
    const m = err?.message || "Something went wrong. Please try again.";
    if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/Email not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox for our link.";
    if (/already registered|already been registered/i.test(m)) return "An account with this email already exists. Sign in instead.";
    if (/Password should be|weak password/i.test(m)) return "Please choose a stronger password (at least 8 characters).";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a moment and try again.";
    if (/Signups not allowed|signup is disabled/i.test(m)) return "New sign-ups are closed at the moment.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Network error. Check your connection and try again.";
    return m;
  }
  function shakeEl(el) { if (!el) return; el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label || "Please wait…")}`; }
    else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
  }
  function requireAuth(reason, then) {
    sessionStorage.setItem("ug_return", location.hash || "#/home");
    if (then) sessionStorage.setItem("ug_then", then);
    toast("info", "Sign in to " + reason, "It's free and takes less than a minute.", { duration: 4500 });
    authTab = "signin";
    location.hash = "/account";
    return false;
  }

  // Sidebar account button + admin shortcut
  function updateNav() {
    $("accountIcon").innerHTML = user ? `<span class="nav-avatar">${esc(initials(myName()))}</span>` : DEFAULT_ACCOUNT_ICON;
    $("accountTip").textContent = user ? myName() : "Sign in";
    $("accountNav").setAttribute("aria-label", user ? "Your account" : "Sign in or create account");
    $("adminLink").hidden = !isAdmin;
  }

  async function refreshUser() {
    if (!user) { profile = null; isAdmin = false; savedIds = new Set(); }
    else {
      const [p, adm, sv] = await Promise.all([
        db.from("profiles").select("display_name,favorite_genres,created_at").eq("id", user.id).maybeSingle(),
        db.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle(),
        db.from("saved_articles").select("article_id").eq("user_id", user.id)
      ]);
      profile = p.data || { display_name: myName(), favorite_genres: [], created_at: user.created_at };
      isAdmin = !!adm.data;
      savedIds = new Set((sv.data || []).map((x) => String(x.article_id)));
    }
    updateNav(); updateSaveBtn();
    if (view === "account" && !$("view-account").hidden) { renderAccount(); enter($("view-account")); }
    if (currentArticle && !$("reader").hidden) renderComments(currentArticle);
  }

  function afterSignIn() {
    const fromEmail = new URLSearchParams(location.search).has("auth");
    if (fromEmail) history.replaceState(null, "", location.pathname + location.hash);
    const back = sessionStorage.getItem("ug_return");
    const then = sessionStorage.getItem("ug_then");
    sessionStorage.removeItem("ug_return"); sessionStorage.removeItem("ug_then");
    if (fromEmail && !recovery) toast("success", "You're in", "Your account is ready. Welcome to UNDERGROUND.");
    if (back && back !== "#/account" && !recovery) location.hash = back.slice(1);
    if (then === "demo") setTimeout(openDemo, 350);
  }

  db.auth.onAuthStateChange((evt, session) => {
    const prev = user?.id || null;
    user = session?.user || null;
    if (evt === "PASSWORD_RECOVERY") { recovery = true; location.hash = "/account"; }
    if (evt === "SIGNED_OUT") recovery = false;
    if (prev !== (user?.id || null) || evt === "PASSWORD_RECOVERY" || evt === "USER_UPDATED") {
      setTimeout(async () => { await refreshUser(); if (evt === "SIGNED_IN" && !prev) afterSignIn(); }, 0);
    }
  });

  // ---- Account view --------------------------------------------------------
  const ICON = {
    bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3.5 7l8.5 6 8.5-6"/>'
  };
  const ic = (k, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const pwField = (name, label, auto, extra = "") => `<label class="field"><span>${label}</span><span class="pw-wrap"><input class="input" name="${name}" type="password" autocomplete="${auto}" minlength="8" required ${extra}><button class="pw-toggle" type="button" aria-label="Show password">${ic("eye")}</button></span></label>`;

  function guestHtml() {
    let form = "";
    if (authTab === "signin") form = `
      <form class="auth-form" data-form="signin" novalidate>
        <div><h2>Welcome back</h2><p class="muted-p">Sign in to your UNDERGROUND account.</p></div>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        ${pwField("password", "Password", "current-password")}
        <div class="form-error" role="alert" hidden></div>
        <button class="btn btn-forest" type="submit">Sign in <span class="arr" aria-hidden="true">→</span></button>
        <p class="fine" style="margin:0;text-align:center"><button class="text-btn" type="button" data-tab-btn="forgot">Forgot your password?</button></p>
      </form>`;
    else if (authTab === "signup") form = `
      <form class="auth-form" data-form="signup" novalidate>
        <div><h2>Create your account</h2><p class="muted-p">Free forever. No spam.</p></div>
        <label class="field"><span>Display name</span><input class="input" name="name" autocomplete="nickname" maxlength="40" placeholder="How you'll appear in comments" required></label>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        ${pwField("password", "Password", "new-password", 'data-strength')}
        <div class="strength" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <p class="fine" id="pwHint" style="margin:-6px 0 0">At least 8 characters. Mix letters, numbers and symbols for a stronger password.</p>
        <div class="form-error" role="alert" hidden></div>
        <button class="btn btn-forest" type="submit">Create account <span class="arr" aria-hidden="true">→</span></button>
        <p class="fine" style="margin:0;text-align:center">By joining you agree to keep comments respectful.</p>
      </form>`;
    else if (authTab === "forgot") form = `
      <form class="auth-form" data-form="forgot" novalidate>
        <div><h2>Reset your password</h2><p class="muted-p">We'll email you a link to choose a new one.</p></div>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        <div class="form-error" role="alert" hidden></div>
        <button class="btn btn-forest" type="submit">Send reset link</button>
        <p class="fine" style="margin:0;text-align:center"><button class="text-btn" type="button" data-tab-btn="signin">Back to sign in</button></p>
      </form>`;
    else form = `
      <div class="auth-form" style="text-align:center;align-items:center;padding:12px 0">
        <span class="big-avatar" style="background:var(--neon-soft);color:var(--neon-hi)">${ic("mail", 28)}</span>
        <h2>Check your inbox</h2>
        <p class="muted-p">We sent a link to <b style="color:var(--ink)">${esc(pendingEmail)}</b>. Open it on this device to continue. It can take a minute, and may land in spam.</p>
        <button class="btn btn-outline" type="button" data-tab-btn="signin">Back to sign in</button>
      </div>`;
    const tabs = (authTab === "signin" || authTab === "signup") ? `
      <div class="tabs" role="tablist" aria-label="Account" data-tab="${authTab}"><span class="tab-pill" aria-hidden="true"></span>
        <button type="button" role="tab" aria-selected="${authTab === "signin"}" data-tab-btn="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="${authTab === "signup"}" data-tab-btn="signup">Create account</button>
      </div>` : "";
    return `
      <div class="auth-wrap">
        <div class="card join bento-item">
          <svg class="wave" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true"></svg>
          <span class="badge-dark"><i aria-hidden="true"></i>Free membership</span>
          <h1>Join the <em>underground</em>.</h1>
          <p>One free account to save stories, join the conversation and put your music in front of our editors.</p>
          <ul class="perks">
            <li><i>${ic("bookmark")}</i>Save articles</li>
            <li><i>${ic("chat")}</i>Comment on stories</li>
            <li><i>${ic("music")}</i>Submit your demo</li>
            <li><i>${ic("star")}</i>Follow your genres</li>
          </ul>
        </div>
        <div class="card auth-card bento-item">${tabs}${form}</div>
      </div>`;
  }

  function recoveryHtml() {
    return `
      <div class="auth-wrap" style="grid-template-columns:minmax(0,520px);justify-content:center">
        <div class="card auth-card bento-item">
          <form class="auth-form" data-form="recover" novalidate>
            <div><h2>Choose a new password</h2><p class="muted-p">You're signed in from your reset link. Set a new password to finish.</p></div>
            ${pwField("password", "New password", "new-password", 'data-strength')}
            <div class="strength" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
            ${pwField("confirm", "Repeat new password", "new-password")}
            <div class="form-error" role="alert" hidden></div>
            <button class="btn btn-forest" type="submit">Save new password</button>
          </form>
        </div>
      </div>`;
  }

  function memberHtml() {
    const name = myName();
    const since = new Date(profile?.created_at || user.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const saved = articles.filter((a) => savedIds.has(String(a.id)));
    const favs = new Set(profile?.favorite_genres || []);
    return `
      <div class="card me bento-item">
        <svg class="wave" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="who"><div class="big-avatar">${esc(initials(name))}</div><div><h1>${esc(name)}</h1><p>${esc(user.email || "")} · Member since ${since}</p></div></div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;position:relative">
          ${isAdmin ? `<a class="btn btn-ghost-dark" href="/admin.html">Admin panel</a>` : ""}
          <button class="btn btn-white" type="button" data-action="signout">Sign out</button>
        </div>
      </div>
      <div class="acct" style="margin-top:18px">
        <div class="col">
          <div class="card pad bento-item">
            <div class="card-title"><h2>Saved articles</h2><span class="hint">${saved.length} saved</span></div>
            ${saved.length ? `<div class="saved-grid">${saved.map((a) => `
              <a class="card lift acard" href="#/a/${keyOf(a)}"><div class="art-wrap">${media(a)}</div>
              <div class="body">${tagHtml(a.genre)}<h3>${esc(a.title)}</h3><div class="meta"><span>${fmtDate(a.published_at)}</span><span>${readTime(a.content)}</span></div></div></a>`).join("")}</div>`
              : `<div class="empty-note">Tap <b>Save</b> on any article and it will wait for you here.</div>`}
          </div>
          <div class="card pad bento-item">
            <div class="card-title"><h2>Your demos</h2><button class="link" type="button" data-demo-open>+ Submit a demo</button></div>
            <ul class="demo-list" id="myDemos"><li><div class="skel" style="height:18px;width:60%"></div></li></ul>
          </div>
        </div>
        <div class="col">
          <form class="card pad bento-item" data-form="profile" novalidate style="display:flex;flex-direction:column;gap:14px">
            <div class="card-title" style="margin:0"><h2>Profile</h2></div>
            <label class="field"><span>Display name</span><input class="input" name="name" maxlength="40" value="${esc(name)}" required></label>
            <div class="field"><span>Favourite genres</span>
              <div class="pills genre-picker" role="group" aria-label="Favourite genres">${GENRES.map((g) => `<button class="pill" type="button" data-fav="${esc(g)}" aria-pressed="${favs.has(g)}">${esc(g)}</button>`).join("")}</div>
            </div>
            <div class="form-error" role="alert" hidden></div>
            <button class="btn btn-forest" type="submit" style="align-self:flex-start">Save profile</button>
          </form>
        </div>
      </div>`;
  }

  function renderAccount() {
    const el = $("view-account");
    el.innerHTML = user ? (recovery ? recoveryHtml() : memberHtml()) : guestHtml();
    const w = el.querySelector(".wave");
    if (w) wave(w, 600, w.viewBox.baseVal.height || 300, 6);
    if (user && !recovery) loadMyDemos();
  }

  async function loadMyDemos() {
    const box = $("myDemos"); if (!box) return;
    const { data, error } = await db.from("demo_submissions").select("id,band_name,genre,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
    if (!$("myDemos")) return;
    if (error) { box.innerHTML = `<li><div class="empty-note" style="width:100%">${notReady(error) ? "Demo submissions are being set up." : "Could not load your demos."}</div></li>`; return; }
    box.innerHTML = (data || []).length ? data.map((d) => `
      <li><div style="min-width:0"><div style="font-weight:700">${esc(d.band_name)}</div><div class="fine">${esc(d.genre || "")} · sent ${fmtDate(d.created_at)}</div></div><span class="status ${esc(d.status)}">${esc(d.status)}</span></li>`).join("")
      : `<li><div class="empty-note" style="width:100%">No demos yet. Send us your best song.</div></li>`;
  }

  function strength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(4, s);
  }

  const acct = $("view-account");
  acct.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab-btn],[data-action],[data-demo-open],.pw-toggle,[data-fav]");
    if (!t) return;
    if (t.dataset.tabBtn) { authTab = t.dataset.tabBtn; renderAccount(); acct.querySelector("input")?.focus(); return; }
    if (t.dataset.action === "signout") { busy(t, true, "Signing out…"); await db.auth.signOut(); toast("info", "Signed out", "See you at the next show."); return; }
    if (t.hasAttribute("data-demo-open")) { openDemo(); return; }
    if (t.classList.contains("pw-toggle")) {
      const i = t.parentElement.querySelector("input"); const show = i.type === "password";
      i.type = show ? "text" : "password"; t.setAttribute("aria-label", show ? "Hide password" : "Show password"); return;
    }
    if (t.dataset.fav) t.setAttribute("aria-pressed", t.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
  acct.addEventListener("input", (e) => {
    e.target.classList.remove("invalid");
    if (e.target.matches("[data-strength]")) {
      const s = strength(e.target.value);
      const colors = ["#1B1729", "#FF2E63", "#FFC23D", "#A48FFF", "#3DF5A7"];
      e.target.closest("form").querySelectorAll(".strength span").forEach((b, i) => { b.style.background = i < s ? colors[s] : ""; });
    }
  });
  acct.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, kind = form.dataset.form;
    const err = form.querySelector(".form-error"), btn = form.querySelector('[type="submit"]');
    const val = (n) => (form.elements[n]?.value || "").trim();
    form.querySelectorAll(".invalid").forEach((i) => i.classList.remove("invalid"));
    err.hidden = true;
    const fail = (msg, field) => {
      err.textContent = msg; err.hidden = false; shakeEl(err);
      if (field) { const i = form.elements[field]; i?.classList.add("invalid"); i?.focus(); }
    };

    if (kind === "signin") {
      if (!EMAIL_RE.test(val("email"))) return fail("Enter a valid email address.", "email");
      if (!form.elements.password.value) return fail("Enter your password.", "password");
      busy(btn, true, "Signing in…");
      const { error } = await db.auth.signInWithPassword({ email: val("email"), password: form.elements.password.value });
      busy(btn, false);
      if (error) return fail(friendly(error));
      toast("success", "Welcome back", "You're signed in.");
      const back = sessionStorage.getItem("ug_return"); const then = sessionStorage.getItem("ug_then");
      sessionStorage.removeItem("ug_return"); sessionStorage.removeItem("ug_then");
      if (back && back !== "#/account") location.hash = back.slice(1);
      if (then === "demo") setTimeout(openDemo, 400);
      return;
    }
    if (kind === "signup") {
      const name = val("name");
      if (name.length < 2 || name.length > 40) return fail("Display name must be 2 to 40 characters.", "name");
      if (!EMAIL_RE.test(val("email"))) return fail("Enter a valid email address.", "email");
      if (form.elements.password.value.length < 8) return fail("Password must be at least 8 characters.", "password");
      busy(btn, true, "Creating account…");
      const { data, error } = await db.auth.signUp({ email: val("email"), password: form.elements.password.value, options: { data: { display_name: name }, emailRedirectTo: AUTH_REDIRECT } });
      busy(btn, false);
      if (error) return fail(friendly(error));
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return fail("An account with this email already exists. Sign in instead.", "email");
      if (!data?.session) { pendingEmail = val("email"); authTab = "check"; renderAccount(); toast("success", "Almost there", "Confirm your email to activate the account."); }
      else toast("success", "Account created", "Welcome to UNDERGROUND, " + name + ".");
      return;
    }
    if (kind === "forgot") {
      if (!EMAIL_RE.test(val("email"))) return fail("Enter a valid email address.", "email");
      busy(btn, true, "Sending…");
      const { error } = await db.auth.resetPasswordForEmail(val("email"), { redirectTo: AUTH_REDIRECT });
      busy(btn, false);
      if (error) return fail(friendly(error));
      pendingEmail = val("email"); authTab = "check"; renderAccount();
      return;
    }
    if (kind === "recover") {
      const pw = form.elements.password.value;
      if (pw.length < 8) return fail("Password must be at least 8 characters.", "password");
      if (pw !== form.elements.confirm.value) return fail("The two passwords don't match.", "confirm");
      busy(btn, true, "Saving…");
      const { error } = await db.auth.updateUser({ password: pw });
      busy(btn, false);
      if (error) return fail(friendly(error));
      recovery = false;
      history.replaceState(null, "", location.pathname + location.hash);
      toast("success", "Password updated", "Use your new password next time you sign in.");
      renderAccount(); enter(acct);
      return;
    }
    if (kind === "profile") {
      const name = val("name");
      if (name.length < 2 || name.length > 40) return fail("Display name must be 2 to 40 characters.", "name");
      const favorite_genres = [...form.querySelectorAll('[data-fav][aria-pressed="true"]')].map((b) => b.dataset.fav);
      busy(btn, true, "Saving…");
      const { error } = await db.from("profiles").upsert({ id: user.id, display_name: name, favorite_genres, updated_at: new Date().toISOString() });
      busy(btn, false);
      if (error) return fail(notReady(error) ? "Profiles are still being set up. Please try again later." : friendly(error));
      profile = { ...(profile || {}), display_name: name, favorite_genres };
      updateNav();
      acct.querySelector(".me h1").textContent = name;
      acct.querySelector(".me .big-avatar").textContent = initials(name);
      toast("success", "Profile saved");
    }
  });

  // ---- Saved articles --------------------------------------------------------
  function updateSaveBtn(pop) {
    const b = $("saveBtn"); if (!b) return;
    const on = !!(user && currentArticle && savedIds.has(String(currentArticle.id)));
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("span").textContent = on ? "Saved" : "Save";
    b.setAttribute("aria-label", on ? "Remove from saved articles" : "Save article");
    if (pop) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
  }
  $("saveBtn").onclick = async () => {
    if (!currentArticle) return;
    if (!user) return requireAuth("save articles");
    const a = currentArticle, id = String(a.id), wasOn = savedIds.has(id);
    wasOn ? savedIds.delete(id) : savedIds.add(id);
    updateSaveBtn(true);
    const res = wasOn
      ? await db.from("saved_articles").delete().eq("user_id", user.id).eq("article_id", a.id)
      : await db.from("saved_articles").insert({ user_id: user.id, article_id: a.id });
    if (res.error) {
      wasOn ? savedIds.add(id) : savedIds.delete(id);
      updateSaveBtn();
      return toast("error", "Could not update saved articles", notReady(res.error) ? "Saving is still being set up." : friendly(res.error));
    }
    toast("success", wasOn ? "Removed from saved" : "Saved for later", wasOn ? "" : "Find it any time in your account.", { duration: 3000 });
  };

  // ---- Comments ----------------------------------------------------------------
  const commentHtml = (c) => {
    const name = c.profiles?.display_name || "Reader";
    const mine = user && (c.user_id === user.id || isAdmin);
    return `<li class="c-item" data-id="${esc(c.id)}">
      <span class="c-av" style="background:${colorFor(c.user_id)}" aria-hidden="true">${esc(initials(name))}</span>
      <div style="min-width:0;flex:1">
        <div class="c-head"><b>${esc(name)}</b><time datetime="${esc(c.created_at)}">${timeAgo(c.created_at)}</time>${mine ? `<button class="c-del" type="button">Delete</button>` : ""}</div>
        <p class="c-body">${esc(c.body)}</p>
      </div></li>`;
  };
  async function renderComments(a) {
    const box = $("comments");
    box.hidden = false;
    box.innerHTML = `<h2 id="commentsTitle">Comments</h2><div class="skel" style="height:64px"></div>`;
    const { data, error } = await db.from("comments").select("id,body,created_at,user_id,profiles(display_name)")
      .eq("article_id", a.id).order("created_at", { ascending: false }).limit(300);
    if (currentArticle !== a) return;
    if (error) {
      if (notReady(error)) { box.hidden = true; box.innerHTML = ""; return; }
      box.innerHTML = `<h2 id="commentsTitle">Comments</h2><div class="empty-note">Comments could not be loaded right now.</div>`;
      return;
    }
    const list = data || [];
    box.innerHTML = `
      <h2 id="commentsTitle">Comments <span class="n" id="cCountBadge">${list.length}</span></h2>
      ${user ? `<form class="c-form" id="cForm" novalidate>
          <label class="sr-only" for="cBody">Your comment</label>
          <textarea class="input" id="cBody" name="body" rows="3" maxlength="2000" placeholder="Share your take, ${esc(myName())}…"></textarea>
          <div class="row"><small class="fine" id="cCount">0 / 2000</small><button class="btn btn-forest" type="submit">Post comment</button></div>
        </form>`
        : `<div class="c-cta"><span>Sign in to join the conversation.</span><button class="btn btn-forest" type="button" data-signin>Sign in</button></div>`}
      <ol class="c-list" id="cList">${list.map(commentHtml).join("") || `<li class="empty-note" id="cEmpty">No comments yet. Be the first to share your take.</li>`}</ol>`;
  }
  const comments = $("comments");
  comments.addEventListener("input", (e) => { if (e.target.id === "cBody") { $("cCount").textContent = e.target.value.length + " / 2000"; e.target.classList.remove("invalid"); } });
  comments.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user || !currentArticle) return;
    const ta = $("cBody"), body = ta.value.trim(), btn = e.target.querySelector('[type="submit"]');
    if (!body) { ta.classList.add("invalid"); shakeEl(ta); ta.focus(); return; }
    busy(btn, true, "Posting…");
    const { data, error } = await db.from("comments").insert({ article_id: currentArticle.id, user_id: user.id, body })
      .select("id,body,created_at,user_id,profiles(display_name)").single();
    busy(btn, false);
    if (error) return toast("error", "Comment not posted", notReady(error) ? "Comments are still being set up." : friendly(error));
    ta.value = ""; $("cCount").textContent = "0 / 2000";
    $("cEmpty")?.remove();
    $("cList").insertAdjacentHTML("afterbegin", commentHtml(data));
    $("cCountBadge").textContent = $("cList").querySelectorAll(".c-item").length;
    toast("success", "Comment posted", "", { duration: 2500 });
  });
  comments.addEventListener("click", async (e) => {
    if (e.target.closest("[data-signin]")) return requireAuth("join the conversation");
    const del = e.target.closest(".c-del"); if (!del) return;
    if (!del.dataset.armed) {
      del.dataset.armed = "1"; del.textContent = "Delete?";
      setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "Delete"; } }, 3000);
      return;
    }
    const li = del.closest(".c-item");
    const { error } = await db.from("comments").delete().eq("id", li.dataset.id);
    if (error) return toast("error", "Could not delete comment", friendly(error));
    li.style.transition = "opacity .25s, transform .25s"; li.style.opacity = "0"; li.style.transform = "translateX(12px)";
    setTimeout(() => { li.remove(); $("cCountBadge").textContent = $("cList").querySelectorAll(".c-item").length; }, 250);
  });

  // ---- Demo submissions ------------------------------------------------------
  function openDemo() {
    if (!user) return requireAuth("submit your demo", "demo");
    const f = $("demoForm");
    f.reset();
    f.elements.contact_email.value = user.email || "";
    if (profile?.favorite_genres?.[0]) f.elements.genre.value = profile.favorite_genres[0];
    f.querySelectorAll(".invalid").forEach((i) => i.classList.remove("invalid"));
    f.querySelector('[data-count-for="message"]').textContent = "0 / 1500";
    $("demoError").hidden = true;
    demoLastFocus = document.activeElement;
    $("demoModal").hidden = false;
    document.body.classList.add("locked");
    setTimeout(() => f.elements.band_name.focus(), 60);
  }
  function closeDemo() {
    if ($("demoModal").hidden) return;
    $("demoModal").hidden = true;
    if ($("reader").hidden) document.body.classList.remove("locked");
    demoLastFocus?.focus?.();
  }
  $("demoModal").addEventListener("click", (e) => { if (e.target.closest("[data-close-demo]")) closeDemo(); });
  $("demoForm").addEventListener("input", (e) => {
    e.target.classList.remove("invalid");
    if (e.target.name === "message") $("demoForm").querySelector('[data-count-for="message"]').textContent = e.target.value.length + " / 1500";
  });
  $("demoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, v = (n) => (f.elements[n].value || "").trim();
    const err = $("demoError");
    const fail = (msg, field) => { err.textContent = msg; err.hidden = false; shakeEl(err); if (field) { f.elements[field].classList.add("invalid"); f.elements[field].focus(); } };
    err.hidden = true;
    if (!v("band_name")) return fail("Tell us the band or artist name.", "band_name");
    if (!EMAIL_RE.test(v("contact_email"))) return fail("Enter an email we can reach you at.", "contact_email");
    let link = v("link");
    if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
    try { const u = new URL(link); if (u.protocol !== "https:" || !u.hostname.includes(".")) throw 0; } catch { return fail("Paste a full https:// link to your music.", "link"); }
    const btn = $("demoSubmit");
    busy(btn, true, "Sending…");
    const { error } = await db.from("demo_submissions").insert({
      user_id: user.id, band_name: v("band_name"), country: v("country") || null, genre: v("genre") || null,
      link, message: v("message") || null, contact_email: v("contact_email")
    });
    busy(btn, false);
    if (error) return fail(notReady(error) ? "Demo submissions are still being set up. Please try again later." : friendly(error));
    closeDemo();
    toast("success", "Demo sent", "Thanks! Track its status in your account.");
    if (view === "account") loadMyDemos();
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

  heroFloor($("heroFloor"));
  recTimer();
  wave($("aboutWave"), 600, 180, 6);
  renderPills(); skeletons();
  const minSplash = new Promise((r) => setTimeout(r, reduceMotion ? 0 : 900));
  const maxSplash = setTimeout(hideSplash, 3000);
  Promise.all([load(), minSplash]).then(() => {
    clearTimeout(maxSplash);
    renderHome(); renderCoverage(); renderGrid(false); renderAbout();
    loadNews();
    loadTracks();
    hideSplash();
    route();
  });
})();
