"""Pemeriksa otomatis untuk worker.py — 2026-11-26.

Dua saringan sebelum artikel boleh dikirim ke /api/ai-publish:
  fact_problems()  - deterministik, tanpa AI: link, tahun, kutipan, angka.
  ai_fact_check()  - satu panggilan model murah: klaim spesifik yang tidak ada di sumber.
"""
import json
import re

YEARS = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
NUMS = re.compile(r"\b\d{2,4}\b")
QUOTES = re.compile(r'[\u201c"](.{15,200}?)[\u201d"]')
URL = re.compile(r"""https?://[^\s<>"']+""")


def _norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def _squash(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _drop_links(text, allowed):
    def keep(m):
        u = m.group(0)
        tail = ""
        while u and u[-1] in ".,);]:":
            tail = u[-1] + tail
            u = u[:-1]
        for a in allowed:
            if a and u.lower().startswith(a.lower()):
                return u + tail
        return tail
    return URL.sub(keep, text)


def _source(item):
    return (
        (item.get("title") or "").strip(),
        (item.get("summary") or item.get("excerpt") or item.get("description") or "").strip(),
        (item.get("link") or item.get("url") or "").strip(),
    )


def fact_problems(parsed, item):
    title, summary, src_url = _source(item)
    source_text = _norm(title + " " + summary + " " + src_url)
    source_flat = _squash(title + " " + summary + " " + src_url)
    allowed = URL.findall(source_text)
    problems = []

    body = parsed.get("CONTENT") or parsed.get("content") or ""
    body = _drop_links(body, allowed)
    if URL.search(body):
        problems.append("tautan di luar sumber")

    if not (item.get("youtubeVideoId") or "").strip() and "youtu" not in source_text:
        parsed["youtubeVideoId"] = ""
        parsed["videoUrl"] = ""

    for y in sorted(set(YEARS.findall(body))):
        if y not in source_text:
            problems.append("tahun " + y + " tidak ada di sumber")

    for q in QUOTES.findall(body):
        qs = _squash(q)
        if qs and qs[:60] not in source_flat:
            problems.append("kutipan tidak ada di sumber: " + _norm(q)[:45])
            break

    if len(summary.split()) < 60:
        stray = [n for n in sorted(set(NUMS.findall(body))) if n not in source_text]
        if len(stray) >= 3:
            problems.append("angka di luar sumber: " + ", ".join(stray[:4]))

    if body.strip():
        parsed["CONTENT"] = body
    return problems


def ai_fact_check(parsed, item, ask):
    title, summary, _ = _source(item)
    body = parsed.get("CONTENT") or parsed.get("content") or ""
    prompt = (
        "You are a strict fact-checker for a music news site.\n"
        "Decide whether the ARTICLE invents specific facts that are NOT in the SOURCE.\n"
        "Specific facts = band names, people, dates, years, numbers, quotes, album or song "
        "titles, tour or release details, chart positions, links.\n"
        "General background that any music fan knows is NOT fabrication.\n"
        'Answer with JSON only: {"verdict": "ok" or "fabricated", "invented": ["..."]}\n'
        'Use "ok" when every specific fact is supported by the source.\n\n'
        "SOURCE TITLE: " + title + "\n"
        "SOURCE TEXT: " + summary + "\n\n"
        "ARTICLE:\n" + body[:6000]
    )
    try:
        raw = ask(prompt, max_tokens=500, role="editor")
    except Exception as e:
        return ["pemeriksa gagal: " + str(e)[:70]]
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return ["pemeriksa tidak menjawab JSON"]
    try:
        data = json.loads(m.group(0))
    except Exception:
        return ["JSON pemeriksa rusak"]
    verdict = str(data.get("verdict") or "").strip().lower()
    if verdict == "ok":
        return []
    bad = data.get("invented") or []
    if isinstance(bad, list) and bad:
        return ["karangan: " + str(bad[0])[:100]]
    return ["pemeriksa menilai fabricated"]


# --- Pengayaan sumber: ambil isi halaman asli kalau ringkasan feed terlalu pendek ---
import html as _html
import urllib.request as _url

FETCH = {"n": 0}
SKIP_P = ("cookie", "subscribe", "sign up", "newsletter", "advertisement")


def _paras(h, limit=6000):
    h = re.sub(r"(?is)<(script|style|noscript|svg|nav|header|footer|aside|form)[^>]*>.*?</\1>", " ", h)
    out = []
    for m in re.findall(r"(?is)<p[^>]*>(.*?)</p>", h):
        t = _html.unescape(re.sub(r"(?s)<[^>]+>", " ", m))
        t = re.sub(r"\s+", " ", t).strip()
        low = t.lower()
        if len(t) >= 60 and not any(k in low for k in SKIP_P):
            out.append(t)
        if sum(len(x) for x in out) >= limit:
            break
    return " ".join(out)[:limit]


def enrich(item, summary, fetch_max=10, min_words=45):
    item["_src_state"] = "ok"
    if len(summary.split()) >= min_words and "continue reading" not in summary.lower():
        return summary
    if FETCH["n"] >= fetch_max:
        item["_src_state"] = "cap"
        return summary
    url = (item.get("link") or item.get("url") or "").strip()
    if not url.startswith("http"):
        item["_src_state"] = "fail"
        return summary
    FETCH["n"] += 1
    item["_src_state"] = "fail"
    try:
        req = _url.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; UndergroundAI/1.0; +https://music.mikasa.me)",
            "Accept": "text/html,application/xhtml+xml",
        })
        text = _paras(_url.urlopen(req, timeout=12).read(400000).decode("utf-8", errors="replace"))
    except Exception:
        return summary
    if len(text.split()) <= len(summary.split()):
        return summary
    print(f"      Sumber diperkaya: {len(summary.split())} -> {len(text.split())} kata")
    item["summary"] = text
    item["_src_state"] = "ok"
    return text
