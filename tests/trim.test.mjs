// Basement Radio trim helpers (assets/trim.js) · node tests/trim.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const T = require("../assets/trim.js");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok", name); };

ok("untrimmed song stays null/null", () => {
  assert.deepEqual(T.normalize(null, null, 250000), { start: null, end: null });
  assert.deepEqual(T.normalize(0, 250000, 250000), { start: null, end: null });
  assert.deepEqual(T.normalize(0, 999999, 250000), { start: null, end: null });
});
ok("normal cut keeps both points", () => assert.deepEqual(T.normalize(42000, 178500, 250000), { start: 42000, end: 178500 }));
ok("cut is at least 1 second", () => {
  assert.deepEqual(T.normalize(10000, 10200, 250000), { start: 10000, end: 11000 });
  assert.deepEqual(T.normalize(249800, null, 250000), { start: 249000, end: null });
});
ok("negative start becomes the beginning", () => assert.deepEqual(T.normalize(-500, 30000, 250000), { start: null, end: 30000 }));
ok("no duration known", () => assert.deepEqual(T.normalize(5000, 35000, null), { start: 5000, end: 35000 }));

const t30 = { duration_sec: 250, trim_start_ms: 60000, trim_end_ms: 90000 };
ok("30 second cut shows 0:30", () => {
  assert.equal(T.isCut(t30), true);
  assert.equal(T.shownSec(t30), 30);
  assert.deepEqual(T.range(t30, 250.2, false), { a: 60, b: 90, cut: true });
});
ok("full mode plays the whole file", () => assert.deepEqual(T.range(t30, 250.2, true), { a: 0, b: 250.2, cut: false }));
ok("full mode ignored when the admin disallows it", () => assert.equal(T.range({ ...t30, allow_full: false }, 250, true).cut, true));
ok("start-only cut runs to the file end", () => {
  const t = { duration_sec: 200, trim_start_ms: 20000, trim_end_ms: null };
  assert.equal(T.shownSec(t), 180);
  assert.deepEqual(T.range(t, 200, false), { a: 20, b: 200, cut: true });
});
ok("end beyond the real file is clamped", () => assert.deepEqual(T.range({ duration_sec: 100, trim_start_ms: 0, trim_end_ms: 120000 }, 95, false), { a: 0, b: 95, cut: true }));
ok("untrimmed and Deezer previews are untouched", () => {
  assert.equal(T.isCut({ duration_sec: 180 }), false);
  assert.equal(T.shownSec({ duration_sec: 180 }), 180);
  assert.equal(T.isCut({ duration_sec: 30, preview: true, trim_start_ms: 5000 }), false);
  assert.deepEqual(T.range({ duration_sec: 180 }, 181, false), { a: 0, b: 181, cut: false });
});
ok("seek bar is relative to the cut", () => {
  const r = T.range(t30, 250, false);
  assert.equal(T.toBar(60, r), 0); assert.equal(T.toBar(75, r), 500); assert.equal(T.toBar(90, r), 1000);
  assert.equal(T.toBar(10, r), 0); assert.equal(T.toBar(200, r), 1000);
  assert.equal(T.fromBar(500, r), 75); assert.equal(T.fromBar(0, r), 60); assert.equal(T.fromBar(1000, r), 90);
});
ok("time format and parsing", () => {
  assert.equal(T.fmt(42000), "0:42.0"); assert.equal(T.fmt(178540), "2:58.5"); assert.equal(T.fmt(3723400), "1:02:03.4");
  assert.equal(T.parse("2:58.5"), 178500); assert.equal(T.parse("62,5"), 62500); assert.equal(T.parse("1:02:03"), 3723000);
  assert.equal(T.parse("abc"), null); assert.equal(T.parse(""), null);
});
ok("peaks are 0..255 and scaled", () => {
  const ch = new Float32Array(1000); for (let i = 0; i < 1000; i++) ch[i] = i < 500 ? 0.1 : 0.5;
  const p = T.peaks([ch], 10);
  assert.equal(p.length, 10); assert.equal(Math.max(...p), 255); assert.equal(p[0], 51);
  assert.ok(T.validWave(p)); assert.ok(!T.validWave([1, 300])); assert.ok(!T.validWave("x"));
});
ok("decode guard is stricter on phones", () => {
  assert.equal(T.canDecode(30 * 1048576, 600, true), true);
  assert.equal(T.canDecode(60 * 1048576, 600, true), false);
  assert.equal(T.canDecode(90 * 1048576, 3600, false), true);
  assert.equal(T.canDecode(90 * 1048576, 3 * 3600, false), false);
});

// Trimming must never touch the audio file: the admin's trim save sends only trim columns
ok("admin trim save never sends audio_path or audio_url", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const m = html.match(/const TRIM_COLS = \[([^\]]+)\]/);
  assert.ok(m, "TRIM_COLS list in admin.html");
  const cols = m[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
  assert.deepEqual(cols.sort(), ["allow_full", "trim_end_ms", "trim_start_ms", "waveform"]);
  const fn = html.slice(html.indexOf("async function saveTrimOnly"), html.indexOf("/* end saveTrimOnly */"));
  assert.ok(fn.length > 50, "saveTrimOnly found");
  assert.ok(!/audio_path|audio_url|uploadFile|uploadChunked|removeFiles|\.delete\(/.test(fn), "saveTrimOnly touches only the trim columns");
});
ok("site loads trim.js before bento.js", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const a = html.indexOf("/assets/trim.js"), b = html.indexOf("/assets/bento.js");
  assert.ok(a > 0 && a < b);
});
console.log(`\n${n} trim tests passed`);
