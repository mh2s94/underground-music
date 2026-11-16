/* Reads embedded song details from an audio file in the browser, with no upload.
 * Supports ID3v2.2/2.3/2.4 (MP3, some WAV/AAC), ID3v1, FLAC Vorbis comments + pictures,
 * and MP4/M4A iTunes atoms.
 * window.readAudioTags(file) → Promise<{ title, artist, album, year, genre, picture: Blob|null }>
 */
(function () {
  "use strict";
  const ID3V1_GENRES = ["Blues","Classic Rock","Country","Dance","Disco","Funk","Grunge","Hip-Hop","Jazz","Metal","New Age","Oldies","Other","Pop","R&B","Rap","Reggae","Rock","Techno","Industrial","Alternative","Ska","Death Metal","Pranks","Soundtrack","Euro-Techno","Ambient","Trip-Hop","Vocal","Jazz+Funk","Fusion","Trance","Classical","Instrumental","Acid","House","Game","Sound Clip","Gospel","Noise","AlternRock","Bass","Soul","Punk","Space","Meditative","Instrumental Pop","Instrumental Rock","Ethnic","Gothic","Darkwave","Techno-Industrial","Electronic","Pop-Folk","Eurodance","Dream","Southern Rock","Comedy","Cult","Gangsta","Top 40","Christian Rap","Pop/Funk","Jungle","Native American","Cabaret","New Wave","Psychadelic","Rave","Showtunes","Trailer","Lo-Fi","Tribal","Acid Punk","Acid Jazz","Polka","Retro","Musical","Rock & Roll","Hard Rock"];
  const ID3V1_EXTRA = { 129: "Hardcore", 137: "Heavy Metal", 138: "Black Metal", 144: "Thrash Metal", 121: "Punk Rock", 131: "Indie" };
  const genreName = (g) => {
    if (!g) return "";
    const m = String(g).match(/^\((\d+)\)\s*(.*)$/) || String(g).match(/^(\d+)$/);
    if (m) { const n = +m[1]; return (m[2] || "").trim() || ID3V1_GENRES[n] || ID3V1_EXTRA[n] || ""; }
    return String(g).trim();
  };
  const latin1 = (b) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
  const decode = (enc, b) => {
    try {
      if (enc === 0) return latin1(b);
      if (enc === 1) return new TextDecoder(b[0] === 0xfe && b[1] === 0xff ? "utf-16be" : "utf-16le").decode(b[0] === 0xff || b[0] === 0xfe ? b.subarray(2) : b);
      if (enc === 2) return new TextDecoder("utf-16be").decode(b);
      return new TextDecoder("utf-8").decode(b);
    } catch { return ""; }
  };
  const strip = (s) => String(s || "").replace(/\u0000+$/g, "").split("\u0000")[0].trim();
  // index of the encoding-specific terminator, starting at `from`
  const term = (b, from, enc) => {
    if (enc === 1 || enc === 2) { for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
    for (let i = from; i < b.length; i++) if (b[i] === 0) return i; return b.length;
  };
  const unsync = (b) => { const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; } return new Uint8Array(out); };
  const ss = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
  const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const slice = async (file, start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());

  async function id3v2(file, out) {
    const h = await slice(file, 0, 10);
    if (latin1(h.subarray(0, 3)) !== "ID3") return false;
    const ver = h[3], flags = h[5], size = ss(h, 6);
    let b = await slice(file, 10, 10 + Math.min(size, 20 * 1048576));
    if ((flags & 0x80) && ver < 4) b = unsync(b);
    let p = 0;
    if (flags & 0x40 && ver >= 3) p += ver === 4 ? ss(b, 0) : u32(b, 0) + 4;
    const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
    const map = ver === 2
      ? { TT2: "title", TP1: "artist", TP2: "albumArtist", TAL: "album", TYE: "year", TCO: "genre" }
      : { TIT2: "title", TPE1: "artist", TPE2: "albumArtist", TALB: "album", TYER: "year", TDRC: "year", TDOR: "origYear", TCON: "genre" };
    while (p + hdrLen < b.length) {
      const id = latin1(b.subarray(p, p + idLen));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const len = ver === 2 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5] : ver === 4 ? ss(b, p + 4) : u32(b, p + 4);
      const fflags = ver === 2 ? 0 : b[p + 9];
      let d = b.subarray(p + hdrLen, p + hdrLen + len);
      p += hdrLen + len;
      if (len <= 0 || d.length < len) break;
      if (ver === 4 && (fflags & 0x02)) d = unsync(d);
      if (ver === 4 && (fflags & 0x01)) d = d.subarray(4); // data length indicator
      if (map[id] && !out[map[id]]) out[map[id]] = strip(decode(d[0], d.subarray(1)));
      else if ((id === "APIC" || id === "PIC") && !out.picture) {
        const enc = d[0]; let q = 1, mime;
        if (id === "PIC") { const f = latin1(d.subarray(1, 4)).toLowerCase(); mime = f === "png" ? "image/png" : "image/jpeg"; q = 4; }
        else { const e = term(d, 1, 0); mime = latin1(d.subarray(1, e)).toLowerCase() || "image/jpeg"; q = e + 1; if (!mime.includes("/")) mime = "image/" + (mime === "png" ? "png" : "jpeg"); }
        q += 1; // picture type
        q = term(d, q, enc) + (enc === 1 || enc === 2 ? 2 : 1);
        const data = d.subarray(q);
        if (data.length > 100) out.picture = new Blob([data], { type: mime === "image/jpg" ? "image/jpeg" : mime });
      }
    }
    return true;
  }

  async function id3v1(file, out) {
    if (file.size < 128) return;
    const b = await slice(file, file.size - 128, file.size);
    if (latin1(b.subarray(0, 3)) !== "TAG") return;
    const f = (s, e) => strip(latin1(b.subarray(s, e)));
    out.title ||= f(3, 33); out.artist ||= f(33, 63); out.album ||= f(63, 93); out.year ||= f(93, 97);
    if (!out.genre && b[127] !== 255) out.genre = String(b[127]);
  }

  async function flac(file, out) {
    let p = 4, last = false;
    for (let guard = 0; !last && guard < 64; guard++) {
      const h = await slice(file, p, p + 4); if (h.length < 4) break;
      last = !!(h[0] & 0x80); const type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
      if (type === 4 || (type === 6 && !out.picture)) {
        const d = await slice(file, p + 4, p + 4 + len);
        const le = (o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
        if (type === 4) {
          let q = 4 + le(0); const n = le(q); q += 4;
          for (let i = 0; i < n && q < d.length; i++) {
            const l = le(q); const kv = new TextDecoder().decode(d.subarray(q + 4, q + 4 + l)); q += 4 + l;
            const k = kv.slice(0, kv.indexOf("=")).toUpperCase(), v = kv.slice(kv.indexOf("=") + 1).trim();
            const key = { TITLE: "title", ARTIST: "artist", ALBUM: "album", DATE: "year", YEAR: "year", GENRE: "genre", ALBUMARTIST: "albumArtist" }[k];
            if (key && !out[key]) out[key] = v;
          }
        } else {
          let q = 4; const ml = u32(d, q); q += 4; const mime = latin1(d.subarray(q, q + ml)) || "image/jpeg"; q += ml;
          const dl = u32(d, q); q += 4 + dl + 16; const pl = u32(d, q); q += 4;
          out.picture = new Blob([d.subarray(q, q + pl)], { type: mime });
        }
      }
      p += 4 + len;
    }
  }

  async function mp4(file, out) {
    // Walk moov → udta → meta → ilst. moov may sit at the end of the file.
    const readBox = async (pos) => { const h = await slice(file, pos, pos + 16); if (h.length < 8) return null; let size = u32(h, 0); const type = latin1(h.subarray(4, 8)); let hdr = 8; if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); hdr = 16; } else if (size === 0) size = file.size - pos; return { size, type, hdr }; };
    let pos = 0, moov = null;
    for (let i = 0; i < 64 && pos < file.size; i++) { const bx = await readBox(pos); if (!bx || bx.size < 8) return; if (bx.type === "moov") { moov = { pos, ...bx }; break; } pos += bx.size; }
    if (!moov || moov.size > 30 * 1048576) return;
    const m = await slice(file, moov.pos, moov.pos + moov.size);
    const find = (from, to, type) => { for (let q = from; q + 8 <= to;) { const s = u32(m, q); if (s < 8) return null; if (latin1(m.subarray(q + 4, q + 8)) === type) return { q, s }; q += s; } return null; };
    const udta = find(8, m.length, "udta"); if (!udta) return;
    const meta = find(udta.q + 8, udta.q + udta.s, "meta"); if (!meta) return;
    const ilst = find(meta.q + 12, meta.q + meta.s, "ilst"); if (!ilst) return;
    const keys = { "©nam": "title", "©ART": "artist", "aART": "albumArtist", "©alb": "album", "©day": "year", "©gen": "genre" };
    for (let q = ilst.q + 8; q + 8 <= ilst.q + ilst.s;) {
      const s = u32(m, q); if (s < 8) break;
      const type = latin1(m.subarray(q + 4, q + 8));
      const data = find(q + 8, q + s, "data");
      if (data) {
        const kind = u32(m, data.q + 8) & 0xffffff, payload = m.subarray(data.q + 16, data.q + data.s);
        if (keys[type] && !out[keys[type]]) out[keys[type]] = new TextDecoder().decode(payload).trim();
        else if (type === "gnre" && !out.genre && payload.length >= 2) out.genre = String(((payload[0] << 8) | payload[1]) - 1);
        else if (type === "covr" && !out.picture) out.picture = new Blob([payload], { type: kind === 14 ? "image/png" : "image/jpeg" });
      }
      q += s;
    }
  }

  window.readAudioTags = async function (file) {
    const out = {};
    try {
      const head = latin1(await slice(file, 0, 12));
      if (head.startsWith("fLaC")) await flac(file, out);
      else if (head.slice(4, 8) === "ftyp") await mp4(file, out);
      else { await id3v2(file, out); await id3v1(file, out); }
    } catch (e) { /* unreadable tags are not an error */ }
    const year = String(out.year || out.origYear || "").match(/(19|20)\d{2}/);
    return {
      title: (out.title || "").trim(), artist: (out.artist || out.albumArtist || "").trim(), album: (out.album || "").trim(),
      year: year ? year[0] : "", genre: genreName(out.genre), picture: out.picture || null
    };
  };
})();
