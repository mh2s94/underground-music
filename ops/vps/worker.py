#!/usr/bin/env python3
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from underground_editorial import ALLOWED_GENRES as CATALOG_GENRES, safe_genre, clean_body, clean_title as clean_headline, ensure_watch_line, build_article_payload

ENV_PATH = Path("/opt/underground-ai/.env")
STATE_PATH = Path("/opt/underground-ai/processed_urls.json")

ALLOWED_GENRES = {
    "Metalcore", "Deathcore", "Hardcore", "Darkcore",
    "Metal", "Post-Hardcore", "Nu Metal", "Death Metal",
    "Black Metal", "Doom Metal", "Thrash Metal", "Punk", "Underground", "Heavy Metal", "Post-Hardcore", "Nu Metal"
}
BAD_KW = ("reggae","dancehall","dub reggae","riddim","bob marley")

SKIP_KEYWORDS = (
    "flash sale", "% off", "discount", "giveaway", "podcast",
    "episode ", "poll:", "vote now", "roundup", "merch drop", "today only"
)


def bad_reggae(t): return any(k in (t or "").lower() for k in BAD_KW)
def yt_id(q):
    try:
        req = urllib.request.Request(f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(q)}", headers={"User-Agent":"Mozilla/5.0"})
        m = re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', urllib.request.urlopen(req, timeout=10).read().decode("utf-8","ignore"))
        return m[0] if m else ""
    except Exception: return ""

def prep_art(p, item):
    p["genre"] = p["GENRE"] = safe_genre(p.get("GENRE") or p.get("genre"))
    t = clean_headline(p.get("TITLE") or p.get("title") or "")
    p["title"] = p["TITLE"] = t
    b = p.get("band") or item.get("band") or ""
    surl = p.get("SOURCE_URL") or item.get("link") or item.get("url") or ""
    m = re.search(r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{11})', surl)
    vid = item.get("youtubeVideoId") or (m.group(1) if m else "") or yt_id(f"{b if b and b.lower()!='various' else item.get('title','')} official")
    img = item.get("image") or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1280&q=85")
    vurl = f"https://www.youtube.com/watch?v={vid}" if vid else ""
    body = ensure_watch_line(clean_body(p.get("CONTENT") or p.get("content") or ""), vid)
    p["content"] = p["CONTENT"] = body
    p["word_count"] = len(re.findall(r"\b\w+\b", body))
    p.update({"image": img, "cover_image": img, "cover_url": img, "youtubeVideoId": vid, "videoUrl": vurl})
    return p

def post_fb(p, r):
    pid, tok = os.environ.get("META_PAGE_ID","").strip(), os.environ.get("META_PAGE_ACCESS_TOKEN","").strip()
    if not pid or not tok: return
    slug = (r.get("slug") if isinstance(r,dict) else "") or re.sub(r'[^a-z0-9]+', '-', p.get('title','').lower()).strip('-')
    url = (r.get("url") if isinstance(r,dict) else "") or f"https://music.mikasa.me/a/{slug}"
    data = urllib.parse.urlencode({"message":f"{p.get('title','')}\n\n{p.get('excerpt','')}\n\nRead more: {url}","link":url,"access_token":tok}).encode()
    try:
        res = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://graph.facebook.com/v21.0/{pid}/feed", data=data, method="POST"), timeout=20).read().decode())
        print("   [FB] Sukses! Post ID:", res.get("id"))
    except Exception as e: print("   [FB] Error:", e)

def load_env():
    if not ENV_PATH.exists():
        print("ERROR: File .env tidak ditemukan di /opt/underground-ai/.env")
        sys.exit(1)
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip()

def load_state():
    if STATE_PATH.exists():
        try:
            return set(json.loads(STATE_PATH.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()

def save_state(urls):
    STATE_PATH.write_text(json.dumps(sorted(list(urls))[-500:], indent=2), encoding="utf-8")

def http_json(url, method="GET", payload=None, headers=None, timeout=60):
    req_headers = {"User-Agent": "Underground-VPS-Worker/2.1"}
    if headers:
        req_headers.update(headers)
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        return resp.status, json.loads(raw) if raw.strip() else {}

import guard

def ask_llm(prompt, max_tokens=1400, role="writer"):
    ck_key = os.environ.get("COPILOTKU_API_KEY", "").strip()
    if ck_key:
        ck_base = os.environ.get("COPILOTKU_BASE_URL", "https://anthropic.platfrom-claude.com/v1").strip().rstrip("/")
        if role == "editor":
            ck_model = os.environ.get("COPILOTKU_MODEL_EDITOR", "Haiku-5.5").strip()
        else:
            ck_model = os.environ.get("COPILOTKU_MODEL_WRITER", "Sonnet-5.5").strip()
        import urllib.request as _ureq, urllib.error as _uerr
        try:
            _payload = json.dumps({
                "model": ck_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max(max_tokens, 4096),
                "temperature": 0.4,
            }).encode("utf-8")
            _req = _ureq.Request(
                f"{ck_base}/chat/completions",
                data=_payload,
                headers={
                    "Authorization": f"Bearer {ck_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "UndergroundAI/1.0",
                },
                method="POST",
            )
            with _ureq.urlopen(_req, timeout=120) as _resp:
                _data = json.loads(_resp.read().decode("utf-8", errors="replace"))
            _choices = _data.get("choices") or []
            if _choices:
                _content = (_choices[0].get("message") or {}).get("content", "")
                if isinstance(_content, str) and _content.strip():
                    print(f"      [AI] Copilotku ({ck_model}) OK")
                    return _content.strip()
            print(f"      [AI] Copilotku ({ck_model}) respon kosong, fallback ke Groq/Gemini...")
            _m = (_choices[0].get("message") or {}) if _choices else {}
            print(f"      [AI-DEBUG] prompt_chars={len(prompt)} max_tokens={max_tokens} status={getattr(_resp, 'status', '?')} top={list(_data)[:8]} choices={len(_choices)} msg_keys={list(_m)[:8]} finish={_choices[0].get('finish_reason') if _choices else None} content_type={type(_m.get('content')).__name__} body={json.dumps(_data)[:220]}")
        except _uerr.HTTPError as _e:
            if _e.code == 402:
                print("      [AI] Copilotku saldo habis (HTTP 402), fallback ke Groq/Gemini...")
            else:
                print(f"      [AI] Copilotku HTTP {_e.code}, fallback ke Groq/Gemini...")
        except Exception as _e:
            print(f"      [AI] Copilotku error ({_e}), fallback ke Groq/Gemini...")
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    primary_model = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b").strip()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()

    if groq_key and not groq_key.startswith("TEMPEL_"):
        for attempt_try in range(3):
            try:
                _, res = http_json(
                    "https://api.groq.com/openai/v1/chat/completions",
                    method="POST",
                    payload={
                        "model": primary_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.35,
                        "max_tokens": max(max_tokens, 4096)
                    },
                    headers={"Authorization": f"Bearer {groq_key}"},
                    timeout=60
                )
                _c0 = res["choices"][0]
                if _c0.get("finish_reason") == "length":
                    print("      [AI] Groq kehabisan token (finish=length); artikel bisa terpotong.")
                return (((_c0.get("message") or {}).get("content")) or "").strip()
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"      Groq limit menit (429), jeda 25 detik lalu coba lagi...")
                    time.sleep(25)
                else:
                    print(f"      Groq HTTP {e.code}, mencoba ulang...")
                    time.sleep(5)
            except Exception as e:
                print(f"      Groq error ({e}), mencoba ulang...")
                time.sleep(5)

    if gemini_key and not gemini_key.startswith("TEMPEL_"):
        for gem_model in ("gemini-2.0-flash", "gemini-1.5-flash"):
            try:
                _, res = http_json(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{gem_model}:generateContent?key={gemini_key}",
                    method="POST",
                    payload={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.35, "maxOutputTokens": max(max_tokens, 4096)}
                    },
                    timeout=60
                )
                return res["candidates"][0]["content"]["parts"][0]["text"].strip()
            except Exception as e:
                print(f"      Gemini {gem_model} gagal ({e})...")

    raise RuntimeError("Semua provider AI (Groq & Gemini) gagal merespons.")

def fetch_radar(news_url):
    _, data = http_json(news_url, timeout=30)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("items") or data.get("news") or data.get("articles") or []
    return []

def build_writer_prompt(item):
    title = item.get("title", "").strip()
    summary = (item.get("summary") or item.get("excerpt") or item.get("description") or "").strip()
    genre_hint = (item.get("genre") or "Underground").strip()

    return f"""You are a staff writer for UNDERGROUND (music.mikasa.me), an independent heavy-music magazine.
Write ORIGINAL English journalism in a sharp, informed, editorial voice — never a reworded summary.

HARD RULES:
- Never invent facts (dates, cities, members, quotes, setlists, prices, venues). Omit if absent.
- Do NOT use quotation marks or any direct quote. Report what people said as indirect statements.
- Never name third-party outlets (Decibel, Loudwire, Distorted Sound, Metal Injection, MetalSucks, Revolver, Kerrang, Blabbermouth, etc.). Write as UNDERGROUND.
- Do NOT prefix titles with "ALBUM REVIEW:", "REVIEW:", "NEWS:", or "FEATURE:".
- Do NOT output a "Source:" line or external links anywhere.
- Cover: rock, pop-rock, pop-punk, metal, metalcore, hardcore, deathcore, darkcore. Never reggae.
- GENRE must be ONE valid catalogue name (e.g. Metalcore, Deathcore, Hardcore Punk, Darkcore, Heavy Metal, Pop Rock, Punk Rock, Post-Hardcore, Nu Metal, Death Metal, Black Metal, Doom Metal, Thrash Metal, Alternative Rock, Underground). Bare "Rock"/"Metal"/"Pop Punk" are NOT valid.
- Body strictly 360 to 460 words in English separated by 2 or 3 '## ' subheadings.

REFERENCE FACTS:
Headline: {title}
Summary: {summary}
Suggested Genre: {genre_hint}

Output plain text with these EXACT uppercase labels (no asterisks or markdown bold on labels):
BAND: <band name or Various>
RELEASE: <release title or None>
TITLE: <compelling English headline, 45-95 chars, no prefix>
EXCERPT: <one-sentence English summary, 120-200 chars>
TAGS: <4 to 8 comma-separated lowercase tags>
GENRE: <ONE valid catalogue genre name>
TYPE: <ONE of: News, Review, Feature, Interview>
SCORE: <0.0-10.0 only if Review, otherwise None>
CONTENT:
<Write 4 substantial paragraphs totaling 360 to 460 words in English with 2 or 3 '## ' subheadings. Do NOT include any Source: line.>"""

def build_verifier_prompt(item, draft_text):
    title = item.get("title", "").strip()
    summary = (item.get("summary") or item.get("excerpt") or item.get("description") or "").strip()

    return f"""You are a strict fact-checking editor for UNDERGROUND (music.mikasa.me).
Verify the DRAFT ARTICLE against the REFERENCE FACTS below:
1. Remove any fabricated dates, cities, members, quotes, or track names not supported by the facts, and rewrite every direct quote as an indirect statement (no quotation marks anywhere).
2. Remove any mention of third-party outlets/magazines, any title prefix like "ALBUM REVIEW:", and any "Source:" line.
3. Keep the CONTENT body strictly between 360 and 460 words in English with 2-3 '## ' subheadings.

REFERENCE FACTS:
Headline: {title}
Summary: {summary}

DRAFT ARTICLE:
{draft_text}

Output ONLY the final corrected plain-text labeled article (BAND, RELEASE, TITLE, EXCERPT, TAGS, GENRE, TYPE, SCORE, CONTENT) with no markdown bold on labels and no extra commentary."""

def expand_if_short(content, source_name, source_url):
    body = clean_body(content)
    words = re.findall(r"\b\w+\b", body)
    if len(words) >= 355:
        return body

    print(f"      Panjang awal {len(words)} kata (<355), menambah 1 paragraf analisis...")
    time.sleep(6)
    prompt = f"""Write ONE additional analytical paragraph (100 to 120 words) in English continuing the UNDERGROUND editorial below. Keep the exact same journalistic tone, do not invent any new facts, dates, or quotes, do not mention outside media or Source lines, and output ONLY the new paragraph text with no headings:

{body}"""
    extra = ask_llm(prompt, max_tokens=300, role="writer")
    extra_clean = clean_body(re.sub(r"^#+\s+.*$", "", extra, flags=re.MULTILINE).strip())
    return f"{body}\n\n## Scene Impact & Outlook\n\n{extra_clean}"

def parse_labeled_article(raw_text, source_name, source_url):
    meta = {}
    content_lines = []
    in_content = False

    for raw_line in raw_text.strip().splitlines():
        clean_line = re.sub(r"^[\*\#\-\s]+", "", raw_line).strip()
        clean_key_line = re.sub(r"\*+", "", clean_line)

        if not in_content:
            if re.match(r"^CONTENT\s*:", clean_key_line, re.IGNORECASE):
                in_content = True
                rest = clean_key_line.split(":", 1)[1].strip()
                if rest:
                    content_lines.append(rest)
                continue
            matched_key = False
            for key in ("BAND", "RELEASE", "TITLE", "EXCERPT", "TAGS", "GENRE", "TYPE", "SCORE"):
                m = re.match(rf"^{key}\s*:\s*(.*)$", clean_key_line, re.IGNORECASE)
                if m:
                    meta[key] = m.group(1).strip().strip("*")
                    matched_key = True
                    break
            if not matched_key and len(meta) >= 3 and len(raw_line.split()) > 12:
                in_content = True
                content_lines.append(raw_line)
        else:
            content_lines.append(raw_line)

    content = "\n".join(content_lines).strip()
    initial_wc = len(re.findall(r"\b\w+\b", content))
    if initial_wc < 355:
        content = expand_if_short(content, source_name, source_url)
    content = clean_body(content)

    genre = safe_genre(meta.get("GENRE", "Underground"))

    art_type = meta.get("TYPE", "News")
    if art_type not in {"News", "Review", "Feature", "Interview"}:
        art_type = "News"

    score = None
    if art_type == "Review":
        try:
            val = float(re.sub(r"[^0-9.]", "", meta.get("SCORE", "")))
            if 0 <= val <= 10:
                score = round(val, 1)
        except Exception:
            score = None

    tags = [t.strip().lower() for t in meta.get("TAGS", "").split(",") if t.strip()]
    clean_title = meta.get("TITLE", "").strip()[:175]
    words = re.findall(r"\b\w+\b", content)

    labeled_block = (
        f"BAND: {meta.get('BAND', 'Various')}\n"
        f"RELEASE: {meta.get('RELEASE', 'None')}\n"
        f"TITLE: {clean_title}\n"
        f"EXCERPT: {meta.get('EXCERPT', '').strip()}\n"
        f"TAGS: {', '.join(tags[:8])}\n"
        f"GENRE: {genre}\n"
        f"TYPE: {art_type}\n"
        f"SCORE: {score if score is not None else 'None'}\n"
        f"CONTENT:\n{content}"
    )

    band_val = None if meta.get("BAND", "None").lower() == "none" else meta.get("BAND")
    rel_val = None if meta.get("RELEASE", "None").lower() == "none" else meta.get("RELEASE")
    exc_val = meta.get("EXCERPT", "").strip()
    return {
        "BAND": band_val, "band": band_val,
        "RELEASE": rel_val, "release": rel_val,
        "TITLE": clean_title, "title": clean_title,
        "EXCERPT": exc_val, "excerpt": exc_val,
        "TAGS": tags[:8], "tags": tags[:8],
        "GENRE": genre, "genre": genre,
        "TYPE": art_type, "type": art_type,
        "SCORE": score, "score": score,
        "CONTENT": content, "content": content,
        "raw": labeled_block,
        "raw_text": labeled_block,
        "text": labeled_block,
        "raw_labeled": labeled_block,
        "SOURCE_NAME": source_name, "source_name": source_name,
        "SOURCE_URL": source_url, "source_url": source_url,
        "word_count": len(words)
    }

def process_batch(limit=1):
    load_env()
    publish_url = os.environ["AI_PUBLISH_URL"]
    radar_url = os.environ["NEWS_RADAR_URL"]
    if "full=1" not in radar_url:
        radar_url += ("&" if "?" in radar_url else "?") + "full=1"
    token = os.environ["AI_PUBLISH_TOKEN"]

    seen_urls = load_state()
    items = fetch_radar(radar_url)
    print(f"Ditemukan {len(items)} item dari Scene Radar.")

    published_count = 0
    attempts = 0
    for item in items:
        if published_count >= limit or attempts >= limit + 15:
            break

        source_url = (item.get("link") or item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        summary = (item.get("summary") or item.get("excerpt") or item.get("description") or "").strip()
        if item.get("body"):
            summary = item["body"]
            item["summary"] = summary
        source_name = (item.get("source") or item.get("source_name") or "Scene Radar").strip()

        if not source_url or not title or source_url in seen_urls:
            continue
        if any(k in title.lower() for k in SKIP_KEYWORDS):
            seen_urls.add(source_url)
            save_state(seen_urls)
            continue
        summary = guard.enrich(item, summary)
        if len(summary.split()) < 60:
            print(f"      Dilewati: sumber terlalu tipis ({len(summary.split())} kata, minimum 60).")
            if item.get("_src_state") != "cap":
                seen_urls.add(source_url)
                save_state(seen_urls)
            continue

        attempts += 1
        print(f"\n[1/3] Menulis draf (API) untuk: {title}")
        t0 = time.time()
        _guard = ("\n\nATURAN TAMBAHAN: sumber ini hanya memberi judul dan ringkasan pendek. "
                  "Jangan mengarang kutipan, tanggal rilis, daftar lagu, angka, tautan, video, atau nama album di luar sumber. "
                  "Tulis 350-500 kata. Jika detail tidak ada di sumber, bahas konteksnya secara umum.")
        draft = ask_llm(build_writer_prompt(item) + _guard, role="writer")
        print(f"      Selesai tahap tulis dalam {time.time() - t0:.1f} detik.")

        time.sleep(12)
        print("[2/3] Memeriksa fakta & panjang artikel...")
        t1 = time.time()
        verified = ask_llm(build_verifier_prompt(item, draft), role="editor")
        print(f"      Selesai tahap periksa dalam {time.time() - t1:.1f} detik.")

        if bad_reggae(title): seen_urls.add(source_url); save_state(seen_urls); continue
        parsed = prep_art(parse_labeled_article(verified, source_name, source_url), item)
        wc = parsed["word_count"]
        print(f"      Hasil akhir: '{parsed['title']}' ({wc} kata, genre: {parsed['genre']})")

        if wc < 350 or wc > 500 or not parsed["title"]:
            print(f"      Dilewati: jumlah kata ({wc}) di luar batas 350-500.")
            seen_urls.add(source_url)
            save_state(seen_urls)
            time.sleep(6)
            continue

        problems = guard.fact_problems(parsed, item)
        if not problems:
            problems = guard.ai_fact_check(parsed, item, ask_llm)
        if problems:
            print("      [TAHAN] " + " | ".join(problems[:3]))
            seen_urls.add(source_url)
            save_state(seen_urls)
            time.sleep(6)
            continue

        print("[3/3] Mengirim ke /api/ai-publish...")
        try:
            api_payload = build_article_payload(
                title=parsed.get("TITLE"),
                excerpt=parsed.get("EXCERPT"),
                content=parsed.get("CONTENT"),
                genre=parsed.get("GENRE"),
                article_type=parsed.get("TYPE"),
                tags=parsed.get("TAGS"),
                source_url=parsed.get("SOURCE_URL"),
                band=parsed.get("BAND"),
                release=parsed.get("RELEASE"),
                score=parsed.get("SCORE"),
                cover_image_url=parsed.get("image"),
                youtube_video_id=parsed.get("youtubeVideoId") or None,
                video_url=parsed.get("videoUrl") or None,
            )
            status, resp = http_json(
                publish_url,
                method="POST",
                payload=api_payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=30
            )
            print(f"      Sukses (HTTP {status}): {json.dumps(resp)}")
            seen_urls.add(source_url)
            save_state(seen_urls)
            published_count += 1
            _st = str(resp.get("status") or "")
            if _st == "published":
                post_fb(parsed, resp)
            else:
                print("   [FB] dilewati: status artikel = " + _st)
            time.sleep(12)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"      HTTP {e.code} dari server: {err_body}")
            if e.code == 429: break
            if e.code == 429: break
            if e.code in (409, 422):
                seen_urls.add(source_url)
                save_state(seen_urls)
        except Exception as e:
            print(f"      Gagal mengirim: {e}")

    print(f"\nSelesai. Total artikel terkirim pada sesi ini: {published_count}")

if __name__ == "__main__":
    max_articles = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    process_batch(limit=max_articles)
