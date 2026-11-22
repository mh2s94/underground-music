// Build a portable copy of the whole site as one zip.
//
// index.html requests its stylesheets and scripts with root-absolute paths (/assets/...). That is
// correct for the deployed site and for the local server, but it breaks the moment the folder is
// moved anywhere that is not the server root — the usual symptom being a page with no theme at all.
// This copies the site, rewrites those paths to relative ones, adds a launcher and a README, and
// zips the result.
//
// What is deliberately NOT included:
//   functions/  — Cloudflare Pages Functions; the panels that call /api/* stay empty without them
//   supabase/   — SQL for the database, not needed to look at the site
//   tests/ docs/ — development material
//
//   node preview/build-package.mjs [output.zip]
//
// Defaults to ../Downloads/underground-site-preview.zip. Only node is required.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.argv[2] || path.join(ROOT, "..", "Downloads", "underground-site-preview.zip");
const STAGE = fs.mkdtempSync("/tmp/ug-package-");
const DIRNAME = "underground";
const PKG = path.join(STAGE, DIRNAME);

// Files copied verbatim, then passed through the path rewrite below.
const COPY = [
  "index.html", "admin.html", "privacy.html", "terms.html",
  "manifest.webmanifest", "robots.txt", "_headers", "_routes.json",
  "data", "assets", "preview",
];

// Rewrites applied to *.html and *.js. Each one is anchored to a leading "/" inside a quoted
// attribute or string so that route paths (/a/, /band/, /charts) and the remote /api/* endpoints are
// left alone, and so aria-keyshortcuts="/ Control+K" is never touched.
const REWRITE = [
  [/="\/assets\//g, '="assets/'],
  [/="\/(admin|privacy|terms)\.html"/g, '="$1.html"'],
  [/="\/manifest\.webmanifest"/g, '="manifest.webmanifest"'],
  [/"\/assets\//g, '"assets/'],
  [/'\/assets\//g, "'assets/"],
  [/"\/data\//g, '"data/'],
  [/'\/data\//g, "'data/"],
  [/"\/(index|admin|privacy|terms)\.html"/g, '"$1.html"'],
  [/'\/index\.html'/g, "'index.html'"],
  [/'\/admin\.html'/g, "'admin.html'"],
  [/'\/privacy\.html'/g, "'privacy.html'"],
  [/'\/terms\.html'/g, "'terms.html'"],
];

const START = `#!/usr/bin/env sh
# Jalankan server kecil untuk folder ini, lalu buka alamat yang dicetak.
# Pakai:  sh start.sh [port]        (port default 8080)
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="\${1:-8080}"

cd "$DIR"
[ -f index.html ] || { echo "index.html tidak ada di $DIR"; exit 1; }

echo "UNDERGROUND - pratinjau lokal"
echo "  folder  : $DIR"
echo "  buka    : http://localhost:$PORT"
echo "  hentikan: tekan Ctrl+C"
echo

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  exec python -m SimpleHTTPServer "$PORT"
elif command -v busybox >/dev/null 2>&1; then
  exec busybox httpd -f -p "$PORT" -h "$DIR"
else
  echo "Tidak menemukan python3 / python / busybox."
  echo "Di Termux:  pkg install python"
  exit 1
fi
`;

function readme(desc) {
  return `UNDERGROUND - paket pratinjau situs
==================================

Ini bukan contoh atau rekaan. Ini file situs aslinya - HTML, CSS dan JS yang sama
dengan yang ada di repo - hanya path-nya diubah dari absolut (/assets/...) menjadi
relatif (assets/...), supaya paket ini bisa dijalankan dari folder mana saja.

Tema aktif:
  ${desc}

CARA LIHAT - pilih salah satu
-----------------------------

A. Paling mirip dengan situs asli (disarankan)

     cd ${DIRNAME}
     sh start.sh

   Lalu buka di browser:  http://localhost:8080

   Cara ini menjalankan situs apa adanya: tema, font, layout, dan data dari
   Supabase ikut hidup seperti di online.

B. Buka langsung tanpa server

   Buka file index.html dari browser (atau "Open with -> Chrome").
   Seluruh tampilan, tema, font dan layout tetap muncul. Tapi karena browser
   memblokir permintaan jaringan dari alamat file://, data dari Supabase
   kemungkinan besar tidak termuat, dan membuka artikel tidak bekerja.
   Cukup untuk menilai visual; untuk pengalaman penuh pakai cara A.

YANG BERBEDA DARI SITUS ONLINE
------------------------------
1. Folder functions/ tidak disertakan (itu serverless function milik Cloudflare).
   Panel yang bergantung padanya jadi kosong:
     - Charts -> tab "Global metal" dan "Bands"
     - Underground wire (berita)
     - Readers (peta pembaca)
   Charts komunitas dan panel lain tetap berjalan.
2. Alamat langsung seperti /a/<judul>, /band/<nama>, /charts tidak bisa dibuka.
   Navigasi dengan klik dari dalam halaman tetap bekerja.
3. _headers (aturan cache + CSP milik Cloudflare) tidak berlaku di server lokal.

ISI PAKET
---------
  index.html  admin.html  privacy.html  terms.html
  manifest.webmanifest  robots.txt  _headers  _routes.json
  start.sh
  assets/   -> semua CSS, JS, ikon, video, dan tema
  data/     -> affiliate-picks.json
  preview/  -> halaman pratinjau satu-file

MEMPERBARUI SETELAH TEMA DIUBAH
-------------------------------
Paket ini potret sesaat. Setelah tema diubah di repo, buat ulang:

     node preview/build-package.mjs
`;
}

// --- copy ---------------------------------------------------------------------------------
fs.mkdirSync(PKG, { recursive: true });
for (const item of COPY) {
  const from = path.join(ROOT, item);
  if (!fs.existsSync(from)) throw new Error("missing: " + item);
  fs.cpSync(from, path.join(PKG, item), { recursive: true });
}
fs.writeFileSync(path.join(PKG, "start.sh"), START, { mode: 0o755 });

// --- rewrite ------------------------------------------------------------------------------
let rewritten = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(html|js|webmanifest)$/.test(e.name)) continue;
    const before = fs.readFileSync(p, "utf8");
    let after = before;
    for (const [re, to] of REWRITE) after = after.replace(re, to);
    if (after !== before) { fs.writeFileSync(p, after); rewritten++; }
  }
}
walk(PKG);

// --- the rewrite must have missed nothing local -------------------------------------------
// Only paths that point at a file in this package count. Route paths (/a/<slug>, /band/<name>,
// /charts) and the remote /api/* endpoints are supposed to stay root-absolute: they are handled by
// the SPA's own router and by the deployment, not by the file system.
const LOCAL = "assets|data|index\\.html|admin\\.html|privacy\\.html|terms\\.html|manifest\\.webmanifest";
const strap = [];
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (!/\.(html|js|webmanifest)$/.test(e.name)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const m of text.matchAll(new RegExp(`(?:href|src)="\\/(?:${LOCAL})`, "g"))) strap.push(path.relative(PKG, p) + ": " + m[0]);
    for (const m of text.matchAll(/["']\/(?:assets|data)\//g)) strap.push(path.relative(PKG, p) + ": " + m[0]);
  }
}
scan(PKG);

// --- README (the theme description comes from the schema, so it cannot go stale) -----------
await import(path.join(ROOT, "assets/theme/schema.js"));
const S = globalThis.UGThemeSchema;
if (!S) throw new Error("assets/theme/schema.js did not register UGThemeSchema");
fs.writeFileSync(path.join(PKG, "README.txt"), readme(S.THEMES[0].desc));

// --- zip (deflate, no dependencies) -------------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = ~0; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
})();

const entries = [];
function collect(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    const name = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) collect(p, name);
    else entries.push({ name: DIRNAME + "/" + name, data: fs.readFileSync(p), mode: e.name.endsWith(".sh") ? 0o755 : 0o644 });
  }
}
collect(PKG, "");

const local = [], central = [];
let offset = 0;
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, "utf8");
  const comp = zlib.deflateRawSync(e.data, { level: 9 });
  const crc = CRC(e.data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x2821, 12);                 // 2000-01-01, fixed for reproducibility
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
  local.push(lh, nameBuf, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x2821, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);
  offset += lh.length + nameBuf.length + comp.length;
}
const cd = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([...local, cd, eocd]));
fs.rmSync(STAGE, { recursive: true, force: true });

// --- report -------------------------------------------------------------------------------
const kb = (n) => Math.round(n / 1024) + " KB";
console.log("wrote " + OUT + "  (" + entries.length + " files, " + kb(fs.statSync(OUT).size) + ")");
console.log("  stripped to relative paths in " + rewritten + " files");
if (strap.length) {
  console.error("\nFAILED: a root-absolute local path survived the rewrite:");
  for (const s of strap.slice(0, 12)) console.error("  " + s);
  process.exit(1);
}
console.log("  no root-absolute local path remains (verified)");
