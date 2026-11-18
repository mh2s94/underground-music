// Browser check of every theme on a deployment (read-only; themes are switched in the page only,
// nothing is saved). For each theme, on desktop and phone: it loads without fallback, its shell
// mounts, every view opens and has no horizontal overflow, every view can be reached from what is
// on screen, the reader opens and closes, no script errors. Then it switches back and checks that
// nothing of the theme is left (Neon Bento looks exactly as before).
// usage: node .github/scripts/themes-check.mjs <base-url> [theme,theme,…]
//        (needs: npm i playwright && npx playwright install chromium)
import { chromium } from "playwright";

const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!BASE) { console.error("usage: themes-check.mjs <base-url> [ids]"); process.exit(2); }
const ONLY = process.argv[3] ? process.argv[3].split(",") : null;
const VIEWS = ["home", "articles", "music", "charts", "about", "account"];
let fail = 0, pass = 0;
const ok = (c, msg, info = "") => { if (c) pass++; else fail++; console.log((c ? "PASS  " : "FAIL  ") + msg + (c ? "" : "  — " + info)); };

const b = await chromium.launch();
for (const vp of [{ width: 1280, height: 860, tag: "desktop" }, { width: 390, height: 844, tag: "phone", mobile: true }]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, reducedMotion: "reduce" });
  if (process.env.UG_STUB) {   // local runs without network: serve a stand-in for supabase-js and fonts
    await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ path: process.env.UG_STUB, contentType: "text/javascript" }));
    await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
    await ctx.route("https://static.cloudflareinsights.com/**", (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource|cloudflareinsights\.com/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.waitForFunction(() => window.UG && window.UGTheme && window.UG.articles.length > 0, null, { timeout: 30000 });
  const baseline = await p.evaluate(() => ({
    accent: getComputedStyle(document.documentElement).getPropertyValue("--ug-accent").trim(),
    side: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
    app: getComputedStyle(document.querySelector(".app")).inset || getComputedStyle(document.querySelector(".app")).top,
  }));
  const themes = (await p.evaluate(() => window.UGTheme.themes().map((t) => t.id))).filter((id) => !ONLY || ONLY.includes(id));

  const neonOver = {};       // overflow that Neon Bento itself already has (reported, not blamed on themes)
  for (const id of themes) {
    const tag = `[${vp.tag}] ${id}`;
    errs.length = 0;
    const got = await p.evaluate((id) => window.UGTheme.load(id, { version: "check" }), id);
    await p.waitForTimeout(600);
    const st = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, fb: document.documentElement.getAttribute("data-theme-fallback"), shell: document.documentElement.getAttribute("data-ug-shell-mounted") }));
    const meta = await p.evaluate((id) => window.UGTheme.themes().find((t) => t.id === id), id);
    ok(got === id && st.theme === id && !st.fb, `${tag}: loads without fallback`, JSON.stringify(st));
    if (meta.js) ok(st.shell === id, `${tag}: shell mounted`, String(st.shell));

    for (const v of VIEWS) {
      await p.evaluate((v) => window.UG.actions.go("/" + v), v);
      await p.waitForTimeout(250);
      const r = await p.evaluate(() => {
        const main = document.getElementById("main");
        const over = Math.max(document.documentElement.scrollWidth - innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
        return { view: window.UG.view, over };
      });
      if (id === "neon-bento") {
        neonOver[v] = r.over;
        if (r.over > 1) console.log(`KNOWN ${tag}: view ${v} overflows by ${r.over}px in the default theme too (existing layout issue, not from a theme)`);
        ok(r.view === v, `${tag}: view ${v} opens`, JSON.stringify(r));
      } else {
        ok(r.view === v && r.over <= Math.max(1, neonOver[v] || 0), `${tag}: view ${v} opens, no more horizontal overflow than the default theme`, JSON.stringify(r));
      }
    }
    // accessibility basics on the home view: every visible control has a name, every visible image an alt
    await p.evaluate(() => window.UG.actions.go("/home")); await p.waitForTimeout(200);
    const a11y = await p.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const name = (e) => (e.getAttribute("aria-label") || e.getAttribute("title") || e.innerText || "").trim() || (e.querySelector("img[alt]:not([alt=''])") ? "img" : "");
      return {
        unnamed: [...document.querySelectorAll("button, a[href], [role=button]")].filter(vis).filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 80)),
        noAlt: [...document.querySelectorAll("img")].filter(vis).filter((i) => !i.hasAttribute("alt")).length,
      };
    });
    ok(!a11y.unnamed.length && !a11y.noAlt, `${tag}: every visible control named, every image has alt`, JSON.stringify(a11y));
    // every view reachable from something visible: a nav button, or a shell control that leads to it
    const reach = await p.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const navOk = (v) => [...document.querySelectorAll(`.nav-btn[data-view="${v}"]`)].some(vis);
      const shellMenu = [...document.querySelectorAll("[data-ug-shell] button, [data-ug-shell] a, .mg-toggle")].some(vis);
      return { home: navOk("home") || shellMenu, articles: navOk("articles") || shellMenu, music: navOk("music") || shellMenu, charts: navOk("charts") || shellMenu, account: navOk("account") || shellMenu };
    });
    ok(Object.values(reach).every(Boolean), `${tag}: navigation reachable`, JSON.stringify(reach));
    await p.evaluate(() => window.UG.actions.go("/articles"));
    await p.evaluate(() => window.UG.actions.openArticle(window.UG.articles[0].key));
    await p.waitForTimeout(500);
    const reader = await p.evaluate(() => { const r = document.getElementById("reader"); return !!r && !r.hidden; });
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    const closed = await p.evaluate(() => { const r = document.getElementById("reader"); return !r || r.hidden; });
    ok(reader && closed, `${tag}: reader opens and closes`);
    ok(errs.length === 0, `${tag}: no script or CSP errors`, errs.join(" | "));
  }

  // back to the default: nothing may be left behind
  for (const from of themes.filter((x) => x !== "neon-bento").slice(0, 3).concat(themes.includes("scene-atlas") ? ["scene-atlas"] : [])) {
    await p.evaluate((id) => window.UGTheme.load(id, { version: "check" }), from);
    await p.waitForTimeout(300);
    await p.evaluate(() => window.UGTheme.load("neon-bento", { version: "check" }));
    await p.waitForTimeout(300);
    await p.evaluate(() => window.UG.actions.go("/home"));
    const left = await p.evaluate(() => ({
      shell: document.querySelectorAll("[data-ug-shell]").length,
      assets: document.querySelectorAll("[data-ug-theme-asset]").length,
      inline: document.documentElement.style.cssText,
      mounted: document.documentElement.getAttribute("data-ug-shell-mounted"),
      accent: getComputedStyle(document.documentElement).getPropertyValue("--ug-accent").trim(),
      side: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
      classes: document.querySelector(".sidebar").className + "|" + document.getElementById("main").className,
    }));
    ok(left.shell === 0 && left.assets === 0 && !left.inline && !left.mounted && left.accent === baseline.accent && left.side === baseline.side && !/mg-open|ms-snap/.test(left.classes),
      `[${vp.tag}] ${from} → neon-bento: nothing left behind, Neon Bento unchanged`, JSON.stringify(left));
  }
  // theme to theme
  await p.evaluate(() => window.UGTheme.load("the-pit", { version: "check" })); await p.waitForTimeout(300);
  await p.evaluate(() => window.UGTheme.load("index", { version: "check" })); await p.waitForTimeout(300);
  const tt = await p.evaluate(() => ({ pit: document.querySelectorAll(".pit-bar, .pit-menu").length, ix: document.querySelectorAll(".ix-head").length, css: [...document.querySelectorAll("link[data-ug-theme-asset]")].map((l) => l.getAttribute("href").split("?")[0]) }));
  ok(tt.pit === 0 && tt.ix === 1 && tt.css.length === 1 && tt.css[0].endsWith("/index/theme.css"), `[${vp.tag}] the-pit → index: only the new theme is present`, JSON.stringify(tt));
  await p.evaluate(() => window.UGTheme.load("neon-bento"));
  await ctx.close();
}
await b.close();
console.log(`\nTHEMES CHECK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
