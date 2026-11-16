"""Read-only archive audit for the Scene Radar sources (Tahap 0). No AI, no database, no writes.
Checks robots.txt, the WordPress REST API (total posts, oldest/newest), paged feeds and sitemaps."""
import json, re, time, urllib.request, urllib.error, urllib.robotparser

UA = "UndergroundMagazineBot/1.0 (+https://music.mikasa.me; archive audit)"
SOURCES = [
    ("Metal Injection", "https://metalinjection.net", "https://metalinjection.net/feed"),
    ("MetalSucks", "https://www.metalsucks.net", "https://www.metalsucks.net/feed/"),
    ("Theprp", "https://www.theprp.com", "https://www.theprp.com/feed/"),
    ("Decibel", "https://www.decibelmagazine.com", "https://www.decibelmagazine.com/feed/"),
    ("Loudwire", "https://loudwire.com", "https://loudwire.com/category/metal/feed/"),
    ("New Noise", "https://newnoisemagazine.com", "https://newnoisemagazine.com/feed/"),
    ("Distorted Sound", "https://distortedsoundmag.com", "https://distortedsoundmag.com/feed/"),
]

def get(url, limit=3_000_000):
    time.sleep(2)  # polite: one request per 2 s
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, dict(r.headers), r.read(limit).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), ""
    except Exception as e:
        return 0, {}, f"ERROR {type(e).__name__}: {e}"

def hdr(h, name):
    for k, v in h.items():
        if k.lower() == name.lower():
            return v
    return None

report = []
for name, base, feed in SOURCES:
    row = {"source": name}
    # robots.txt
    st, h, body = get(base + "/robots.txt")
    rp = urllib.robotparser.RobotFileParser(); rp.parse(body.splitlines() if st == 200 else [])
    row["robots_status"] = st
    row["robots_allows_wp_json"] = rp.can_fetch(UA, base + "/wp-json/wp/v2/posts")
    row["robots_allows_feed"] = rp.can_fetch(UA, feed)
    row["robots_sitemaps"] = re.findall(r"(?im)^sitemap:\s*(\S+)", body)[:5]
    # WordPress REST API
    st, h, body = get(base + "/wp-json/wp/v2/posts?per_page=1&_fields=id,date,link")
    row["wp_rest_status"] = st
    row["wp_total_posts"] = hdr(h, "X-WP-Total")
    row["wp_total_pages_at_100"] = None
    if st == 200 and row["wp_total_posts"]:
        try:
            row["newest"] = json.loads(body)[0]["date"]
            row["wp_total_pages_at_100"] = -(-int(row["wp_total_posts"]) // 100)
        except Exception as e:
            row["newest"] = f"parse error {e}"
        st2, h2, body2 = get(base + "/wp-json/wp/v2/posts?per_page=1&order=asc&_fields=id,date,link")
        try:
            row["oldest"] = json.loads(body2)[0]["date"] if st2 == 200 else f"HTTP {st2}"
        except Exception as e:
            row["oldest"] = f"parse error {e}"
        st3, h3, body3 = get(base + "/wp-json/wp/v2/posts?per_page=100&page=2&_fields=id")
        row["wp_page_of_100_status"] = st3
        try: row["wp_page_of_100_items"] = len(json.loads(body3)) if st3 == 200 else 0
        except Exception: row["wp_page_of_100_items"] = 0
    else:
        row["wp_rest_body_start"] = body[:120]
    # Paged feed (fallback)
    sep = "&" if "?" in feed else "?"
    st, h, body = get(feed + sep + "paged=5")
    row["feed_paged5_status"] = st
    row["feed_paged5_items"] = len(re.findall(r"<item[\s>]", body)) if st == 200 else 0
    dates = re.findall(r"<pubDate>([^<]+)</pubDate>", body)
    row["feed_paged5_dates"] = [dates[0], dates[-1]] if dates else []
    # Sitemap: count post sitemap files in the index (do not download them all)
    sm_url = next((s for s in row["robots_sitemaps"]), base + "/sitemap_index.xml")
    st, h, body = get(sm_url)
    row["sitemap_index"] = sm_url
    row["sitemap_status"] = st
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", body)
    post_maps = [u for u in locs if re.search(r"post", u, re.I) and not re.search(r"page|tag|categor|author", u, re.I)]
    row["sitemap_entries"] = len(locs)
    row["sitemap_post_files"] = len(post_maps)
    if post_maps:
        st4, h4, body4 = get(post_maps[0])
        row["first_post_sitemap_urls"] = len(re.findall(r"<loc>", body4)) if st4 == 200 else f"HTTP {st4}"
    report.append(row)
    print(json.dumps(row, ensure_ascii=False), flush=True)

with open("radar-audit.json", "w") as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
