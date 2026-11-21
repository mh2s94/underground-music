// Opens a deployment in headless Chromium and checks that supabase-js (pinned + SRI) loads and the
// app starts: public page shows articles, admin page shows its login. Read-only.
// usage: node .github/scripts/browser-check.mjs <base-url>   (needs: npm i playwright && npx playwright install chromium)
import { chromium } from "playwright";
const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!BASE) { console.error("usage: browser-check.mjs <base-url>"); process.exit(2); }
let fail = 0;
const ok = (c, msg, info = "") => { console.log((c ? "PASS  " : "FAIL  ") + msg + (c ? "" : "  — " + info)); if (!c) fail++; };
const b = await chromium.launch();
for (const [path, vp] of [["/", { width: 1280, height: 900 }], ["/", { width: 390, height: 844 }], ["/admin", { width: 1280, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp });
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  const failed = [];
  p.on("requestfailed", (r) => failed.push(r.url() + " (" + (r.failure()?.errorText || "failed") + ")"));
  // Cloudflare Web Analytics refuses preview origins (CORS): not an error of the site.
  p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource|cloudflareinsights\.com|^Permissions policy violation: compute-pressure/.test(m.text())) errs.push(m.text()); });
  const tag = `${path} ${vp.width}px`;
  await p.goto(BASE + path, { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(5000);
  ok(await p.evaluate(() => typeof window.supabase?.createClient === "function"), `${tag}: supabase-js loaded`);
  ok(!errs.some((e) => /integrity|subresource/i.test(e)), `${tag}: no SRI error`, errs.join(" | "));
  if (path === "/") {
    const n = await p.evaluate(() => (window.UG && window.UG.articles ? window.UG.articles.length : -1));
    ok(n > 0, `${tag}: articles loaded from Supabase (${n})`, String(n));
  } else {
    ok(await p.evaluate(() => !!document.querySelector("input[type=email], input[type=password]")), `${tag}: admin login form shown`);
  }
  ok(errs.length === 0, `${tag}: no script or CSP errors in the console`, errs.join(" | "));
  // Network failures of our own site, Supabase or the CDN matter; third-party beacons/fonts are only reported.
  const own = new RegExp("^(" + BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|https://[a-z0-9]+\\.supabase\\.co|https://cdn\\.jsdelivr\\.net)");
  const ownFailed = failed.filter((u) => own.test(u)), other = failed.filter((u) => !own.test(u));
  ok(ownFailed.length === 0, `${tag}: no failed requests to the site, Supabase or the CDN`, ownFailed.join(" | "));
  if (other.length) console.log(`INFO  ${tag}: third-party requests not loaded: ${other.join(" | ")}`);
  await p.close();
}
// Stage 2: direct navigation, search filters, band profile reload and related stories.
const stage2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
const stage2Errors = [];
stage2.on("pageerror", (e) => stage2Errors.push(e.message));
await stage2.goto(BASE + "/search", { waitUntil: "load", timeout: 30000 });
await stage2.waitForTimeout(3500);
ok(await stage2.locator("#pageSearchInput").isVisible(), "/search direct navigation renders the search page");
ok(await stage2.locator('[data-search-filter="ALL"]').count() === 1, "/search exposes ALL filter");
ok(await stage2.locator('[data-search-filter="VIDEO"]').count() === 1, "/search exposes VIDEO filter");
await stage2.locator('[data-search-filter="VIDEO"]').click();
const genreChip = stage2.locator('[data-search-filter]:not([data-search-filter="ALL"]):not([data-search-filter="VIDEO"])').first();
if (await genreChip.count()) {
  const genreName = await genreChip.getAttribute("data-search-filter");
  await genreChip.click();
  const combined = await stage2.evaluate((g) => {
    const video = document.querySelector('[data-search-filter="VIDEO"]');
    const genre = [...document.querySelectorAll("[data-search-filter]")].find((x) => x.dataset.searchFilter === g);
    return video?.getAttribute("aria-pressed") === "true" && genre?.getAttribute("aria-pressed") === "true";
  }, genreName);
  ok(combined, "/search combines VIDEO and genre filters");
} else {
  ok(false, "/search exposes dynamic genre filters");
}
await stage2.locator("#pageSearchInput").fill(" ");
await stage2.waitForTimeout(200);
const bandUrl = await stage2.evaluate(() => window.UG?.articles?.find((a) => a.bandUrl)?.bandUrl || "");
if (bandUrl) {
  await stage2.goto(BASE + bandUrl, { waitUntil: "load", timeout: 30000 });
  await stage2.waitForTimeout(3500);
  ok(await stage2.locator("#view-band h1").count() === 1, "band profile direct navigation renders its header");
  ok(await stage2.locator("#bhStories .search-result-card").count() > 0, "band profile lists published stories");
  await stage2.reload({ waitUntil: "load" });
  await stage2.waitForTimeout(2500);
  ok(await stage2.locator("#view-band h1").count() === 1, "band profile reload works");
} else {
  ok(false, "home archive provides a band profile test target");
}
const articleUrl = await stage2.evaluate(() => {
  const rows = window.UG?.articles || [];
  const pick = rows.find((a) => a.url && rows.some((b) => b.id !== a.id && ((a.band && b.band === a.band) || (a.genre && b.genre === a.genre))));
  return pick?.url || "";
});
if (articleUrl) {
  await stage2.goto(BASE + articleUrl, { waitUntil: "load", timeout: 30000 });
  await stage2.waitForTimeout(3500);
  ok(await stage2.locator("#readerBody .related-stories").count() === 1, "article reader displays Related Stories");
} else {
  console.log("INFO  related stories browser assertion skipped: no matching article pair in the loaded archive");
}
ok(stage2Errors.length === 0, "Stage 2 routes have no browser runtime errors", stage2Errors.join(" | "));
await stage2.close();

await b.close();
console.log(`\nBROWSER CHECK: ${fail ? fail + " failed" : "all passed"}`);
process.exit(fail ? 1 : 0);
