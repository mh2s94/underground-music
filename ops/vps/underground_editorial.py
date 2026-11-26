"""Editorial + payload helpers for the UNDERGROUND autopilot (worker.py)."""
from __future__ import annotations
import re

ALLOWED_GENRES = [
    "Classic Rock", "Hard Rock", "Alternative Rock", "Indie Rock", "Pop Rock",
    "Punk Rock", "Post-Punk", "Grunge", "Shoegaze", "Gothic Rock", "Post-Rock",
    "Progressive Rock", "Psychedelic Rock", "Glam Rock",
    "Heavy Metal", "Thrash Metal", "Groove Metal", "Nu Metal", "Power Metal",
    "Doom Metal", "Death Metal", "Melodic Death Metal", "Black Metal",
    "Progressive Metal", "Alternative Metal", "Industrial Metal",
    "Metalcore", "Melodic Metalcore", "Progressive Metalcore", "Modern Metalcore",
    "Deathcore", "Melodic Deathcore", "Technical Deathcore", "Modern Deathcore",
    "Hardcore Punk", "Metallic Hardcore", "Melodic Hardcore", "Post-Hardcore",
    "Beatdown Hardcore", "Grindcore", "Mathcore", "Darkcore",
    "Underground",
]
_CANON = {g.lower(): g for g in ALLOWED_GENRES}

def safe_genre(value: str) -> str:
    s = re.sub(r'[\u201c\u201d"\'*`]', "", str(value or "")).strip()
    if s.lower() in _CANON:
        return _CANON[s.lower()]
    low = " " + re.sub(r"[^a-z0-9&+\- ]+", " ", s.lower()) + " "
    for g in sorted(ALLOWED_GENRES, key=len, reverse=True):
        if " " + g.lower() + " " in low:
            return g
    return "Underground"

_SOURCE_LINE = re.compile(r'^\s*Source:\s*.*$', re.I | re.M)
_WATCH_LINE = re.compile(r'^\s*Watch on YouTube:\s*https?://\S+\s*$', re.I | re.M)
_BLOCKED_MEDIA = re.compile(
    r'\b(Decibel|Loudwire|Distorted\s+Sound|Metal\s+Injection|MetalSucks|ThePRP|'
    r'Revolver|Kerrang|Blabbermouth|Lambgoat|BrooklynVegan|Consequence|NME|'
    r'Rolling\s+Stone|Pitchfork)\b', re.I)
_BAD_PREFIX = re.compile(r'^\s*(ALBUM\s+REVIEW|REVIEW|NEWS|FEATURE)\s*:\s*', re.I)

def strip_source_line(content: str) -> str:
    return "\n".join(l for l in str(content or "").splitlines() if not _SOURCE_LINE.match(l)).strip()

def scrub_media_names(content: str) -> str:
    return _BLOCKED_MEDIA.sub("UNDERGROUND", str(content or ""))

def clean_body(content: str) -> str:
    return scrub_media_names(strip_source_line(content)).strip()

def clean_title(title: str) -> str:
    return _BAD_PREFIX.sub("", str(title or "")).strip()

def ensure_watch_line(content: str, video_id):
    content = str(content or "").rstrip()
    if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(video_id)):
        return content
    if _WATCH_LINE.search(content):
        return content
    return content + "\n\nWatch on YouTube: https://www.youtube.com/watch?v=" + str(video_id)

def build_article_payload(*, title, excerpt, content, genre, article_type, tags,
                          source_url=None, band=None, release=None, score=None,
                          cover_image_url=None, youtube_video_id=None, video_url=None):
    body = ensure_watch_line(clean_body(content), youtube_video_id)
    article = {
        "TITLE": clean_title(title),
        "EXCERPT": str(excerpt or "").strip(),
        "CONTENT": body,
        "GENRE": safe_genre(genre),
        "TYPE": article_type,
        "TAGS": list(tags or []),
    }
    if band: article["BAND"] = band
    if release: article["RELEASE"] = release
    if score is not None: article["SCORE"] = score
    if cover_image_url: article["image"] = cover_image_url
    if youtube_video_id: article["youtubeVideoId"] = youtube_video_id
    if video_url: article["videoUrl"] = video_url
    if source_url: article["SOURCE_URL"] = source_url
    return {"article": article}
