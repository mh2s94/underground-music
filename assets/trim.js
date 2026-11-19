/* Basement Radio · non-destructive trim helpers (shared by the site player and the admin editor).
 * A trim is two numbers stored on the track: trim_start_ms and trim_end_ms. The audio file itself is
 * never changed; the player only plays the chosen part. null means "from the start" / "to the end".
 * window.UGTrim (browser) · module.exports (node tests)
 */
(function (root) {
  "use strict";
  const MIN_MS = 1000;            // shortest allowed cut: 1 second
  const MAX_MS = 7200 * 1000;     // same limit as tracks.duration_sec (2 hours)
  const int = (v) => (v == null || v === "" || !isFinite(+v) ? null : Math.round(+v));

  // Clean a pair of trim points against the file length (ms). Returns { start, end } where a value
  // is null when it equals the file edge, so an untrimmed song stays { start: null, end: null }.
  function normalize(startMs, endMs, durationMs) {
    const dur = int(durationMs) && int(durationMs) > 0 ? Math.min(int(durationMs), MAX_MS) : null;
    let s = int(startMs), e = int(endMs);
    s = s == null ? 0 : Math.max(0, s);
    if (dur != null) { if (e == null || e > dur) e = dur; } else if (e != null) e = Math.min(e, MAX_MS);
    if (dur != null && s > dur - MIN_MS) s = Math.max(0, dur - MIN_MS);
    if (e != null && e - s < MIN_MS) e = s + MIN_MS;
    if (dur != null && e != null && e > dur) { e = dur; s = Math.max(0, e - MIN_MS); }
    return {
      start: s <= 0 ? null : s,
      end: e == null || (dur != null && e >= dur) ? null : e
    };
  }

  const isCut = (t) => !!t && !t.preview && ((int(t.trim_start_ms) || 0) > 0 || int(t.trim_end_ms) != null);
  const fullAllowed = (t) => !t || t.allow_full !== false;

  // Playback window in seconds for a track. mediaSec = the real file length once known.
  // full = the listener chose "Play full". Returns { a, b, cut }.
  function range(t, mediaSec, full) {
    const d = isFinite(mediaSec) && mediaSec > 0 ? mediaSec : (t && t.duration_sec) || 0;
    if (!isCut(t) || (full && fullAllowed(t))) return { a: 0, b: d, cut: false };
    const a = Math.max(0, (int(t.trim_start_ms) || 0) / 1000);
    let b = int(t.trim_end_ms) != null ? int(t.trim_end_ms) / 1000 : d;
    if (d > 0) b = Math.min(b, d);
    if (!(b > a)) b = d > a ? d : a;
    return { a: Math.min(a, b), b, cut: true };
  }

  // Length the site shows for a track (seconds): the cut length when trimmed, else duration_sec.
  function shownSec(t) {
    if (!t) return 0;
    if (!isCut(t)) return t.duration_sec || 0;
    const r = range(t, t.duration_sec || 0, false);
    return Math.max(0, Math.round(r.b - r.a));
  }

  // Position helpers for the seek bars (0..1000 like the existing range inputs)
  const toBar = (cur, r) => (r.b > r.a ? Math.round(Math.min(1, Math.max(0, (cur - r.a) / (r.b - r.a))) * 1000) : 0);
  const fromBar = (v, r) => r.a + Math.min(1000, Math.max(0, +v || 0)) / 1000 * (r.b - r.a);

  // m:ss.s and parsing (accepts "1:02.5", "62.5", "1:02", "0:00:12")
  function fmt(ms) {
    ms = Math.max(0, Math.round((ms || 0) / 100) * 100);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = (ms % 60000) / 1000;
    const ss = s.toFixed(1).padStart(4, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss;
  }
  function parse(str) {
    const v = String(str || "").trim().replace(",", ".");
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(v)) return null;
    const parts = v.split(":").map(Number);
    let sec = 0; for (const p of parts) sec = sec * 60 + p;
    return Math.round(sec * 1000);
  }

  // Peaks from decoded channel data → small array of 0..255 for the editor waveform.
  function peaks(channels, n) {
    n = Math.max(1, n | 0);
    const len = channels.length ? channels[0].length : 0;
    const out = new Array(n).fill(0);
    if (!len) return out;
    const per = len / n, stride = Math.max(1, Math.floor(per / 400)); // sample at most ~400 points per bucket
    let top = 0;
    for (let i = 0; i < n; i++) {
      const from = Math.floor(i * per), to = Math.min(len, Math.floor((i + 1) * per));
      let m = 0;
      for (const ch of channels) for (let j = from; j < to; j += stride) { const x = Math.abs(ch[j]); if (x > m) m = x; }
      out[i] = m; if (m > top) top = m;
    }
    return out.map((x) => (top ? Math.round(x / top * 255) : 0));
  }
  const validWave = (w) => Array.isArray(w) && w.length > 1 && w.length <= 2000 && w.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);

  // Should this device try to decode the whole file for a waveform? (memory guard; see the proposal)
  function canDecode(bytes, sec, phone) {
    if (phone) return (bytes || 0) <= 40 * 1048576 && (sec || 0) <= 20 * 60;
    return (bytes || 0) <= 100 * 1048576 && (sec || 0) <= 2 * 3600;
  }

  // Browser only: decode an ArrayBuffer at a low sample rate (less memory) and return peaks
  async function waveformFrom(buf, n) {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) throw new Error("Web Audio is not available");
    const ctx = new OAC(1, 1, 8000);
    const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
    const chans = []; for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) chans.push(audio.getChannelData(c));
    return { peaks: peaks(chans, n || 600), sec: audio.duration };
  }

  const api = { MIN_MS, MAX_MS, normalize, isCut, fullAllowed, range, shownSec, toBar, fromBar, fmt, parse, peaks, validWave, canDecode, waveformFrom };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UGTrim = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
