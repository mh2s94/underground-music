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
  p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource|cloudflareinsights\.com/.test(m.text())) errs.push(m.text()); });
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
await b.close();
console.log(`\nBROWSER CHECK: ${fail ? fail + " failed" : "all passed"}`);
process.exit(fail ? 1 : 0);
