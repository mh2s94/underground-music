#!/usr/bin/env bash
# Checks a Cloudflare Pages preview deployment of this repo against the files in the commit.
# usage: verify-preview.sh <preview-url> [production-url] [baseline-preview-url]
# baseline-preview-url: optional preview deployment WITHOUT this change (same preview environment, same
# missing secrets), used to tell "preview has no secrets" apart from a real side effect.
set -uo pipefail
PREV="${1%/}"; PROD="${2:-https://music.mikasa.me}"; PROD="${PROD%/}"; BASE="${3:-}"; BASE="${BASE%/}"
T=$(mktemp -d); pass=0; fail=0
ok()   { pass=$((pass+1)); echo "PASS  $*"; }
bad()  { fail=$((fail+1)); echo "FAIL  $*"; }
info() { echo "INFO  $*"; }
get()  { # get <url> <name> [extra curl args] -> $T/<name>.h (headers, lower-case) $T/<name>.b (body)
  local u="$1" n="$2"; shift 2
  curl -s -m 25 "$@" -D "$T/$n.h" -o "$T/$n.b" "$u" || true
  tr 'A-Z' 'a-z' < "$T/$n.h" | tr -d '\r' > "$T/$n.hl"
}
status() { head -1 "$T/$1.hl" | awk '{print $2}'; }
hval()   { grep -m1 "^$2:" "$T/$1.hl" | cut -d' ' -f2- ; }
has()    { grep -q "^$2:" "$T/$1.hl"; }
sha()    { sha256sum "$1" | cut -c1-64; }
CSP=$(grep -m1 "Content-Security-Policy:" _headers | sed 's/^ *Content-Security-Policy: *//' | tr 'A-Z' 'a-z')

echo "Preview: $PREV"; echo "Commit:  $(git rev-parse --short HEAD)"; echo
# A fresh deployment can answer with Cloudflare's own 404 page for a short while. Wait until it is
# stable: 5 consecutive good answers from a static file, a page and a Function (max ~3 min).
good=0
for i in $(seq 1 60); do
  a=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$PREV/robots.txt"); b=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$PREV/terms"); c=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$PREV/api/news")
  if [[ "$a$b$c" == 200200200 ]]; then good=$((good+1)); [[ $good -ge 5 ]] && break; else good=0; fi
  sleep 3
done
echo "Deployment stable after $i checks"; sleep 10; echo

echo "== 1. Build output = repository root, static files untouched, _routes.json exclusions"
for f in assets/bento.css assets/theme/schema.js assets/theme/runtime.js assets/favicon.svg robots.txt manifest.webmanifest; do
  n=$(echo "$f" | tr '/.' '__'); get "$PREV/$f" "$n"
  s=$(status "$n")
  if [[ "$s" == 200 && "$(sha "$T/$n.b")" == "$(sha "$f")" ]]; then ok "/$f 200, byte-identical to repo file"; else bad "/$f status $s or body differs from repo"; fi
  has "$n" x-ug-theme && bad "/$f has x-ug-theme (middleware touched a static file)" || ok "/$f no x-ug-theme"
  [[ "$(hval "$n" x-frame-options)" == "deny" ]] && ok "/$f X-Frame-Options DENY (from _headers)" || bad "/$f X-Frame-Options missing"
done
get "$PREV/favicon.ico" ico; get "$PROD/favicon.ico" ico_p
[[ "$(status ico)" == "$(status ico_p)" ]] && ok "/favicon.ico status $(status ico) same as production" || bad "/favicon.ico $(status ico) vs production $(status ico_p)"
has ico x-ug-theme && bad "/favicon.ico has x-ug-theme" || ok "/favicon.ico no x-ug-theme"
for f in _routes.json _headers; do
  n=cfg$(echo "$f" | tr -c 'a-z' '_'); get "$PREV/$f" "$n"
  if cmp -s "$T/$n.b" "$f"; then bad "/$f is served as a downloadable file (Pages did not treat it as config)"
  else ok "/$f not served as a file (status $(status "$n") = site fallback page): Pages took it as config from the output root"; fi
done

echo; echo "== 2. HTML pages run the middleware"
for p in "/" "/privacy" "/terms" "/a/__no_such_story__" "/band/__no_such_band__" "/unsubscribe"; do
  n=page$(echo "$p" | tr -c 'a-z0-9' '_'); get "$PREV$p" "$n"; s=$(status "$n")
  th=$(hval "$n" x-ug-theme)
  [[ -n "$th" ]] && ok "$p status $s, x-ug-theme: $th" || bad "$p status $s, x-ug-theme missing"
  dt=$(grep -o '<html[^>]*data-theme="[a-z-]*"' "$T/$n.b" | head -1 | sed 's/.*data-theme="\([a-z-]*\)"/\1/')
  [[ -n "$dt" && "$th" == "$dt@"* ]] && ok "$p <html data-theme=\"$dt\"> matches x-ug-theme" || bad "$p data-theme '$dt' missing or not matching x-ug-theme '$th'"
  [[ "$(hval "$n" content-security-policy)" == "$CSP" ]] && ok "$p CSP identical to _headers" || bad "$p CSP differs from _headers"
  [[ "$(hval "$n" x-frame-options)" == "deny" ]] && has "$n" strict-transport-security && has "$n" x-content-type-options && has "$n" referrer-policy && has "$n" permissions-policy && has "$n" cross-origin-opener-policy \
    && ok "$p X-Frame-Options DENY, HSTS, nosniff, referrer, permissions, COOP" || bad "$p a security header is missing"
done
get "$PREV/unsubscribe" unsub; [[ "$(hval unsub cache-control)" == "no-store" ]] && ok "/unsubscribe keeps cache-control: no-store" || bad "/unsubscribe cache-control $(hval unsub cache-control)"
for p in /privacy.html /terms.html; do n=r$(echo "$p" | tr -c 'a-z' '_'); get "$PREV$p" "$n"; get "$PROD$p" "${n}_p"
  [[ "$(status "$n")" == "$(status "${n}_p")" && "$(hval "$n" location)" == "$(hval "${n}_p" location)" ]] && ok "$p $(status "$n") → $(hval "$n" location), same as production" || bad "$p $(status "$n") $(hval "$n" location) vs production $(status "${n}_p") $(hval "${n}_p" location)"
done
get "$PREV/" home_head -I
has home_head x-ug-theme && bad "HEAD / was themed" || ok "HEAD / passes through (no theme work)"
has home_head content-security-policy && ok "HEAD / still has CSP" || bad "HEAD / lost CSP"
get "$PREV/admin" admin; get "$PREV/admin.html" admin_r
[[ "$(status admin)" == 200 ]] && ok "/admin 200 (/admin.html → $(status admin_r) $(hval admin_r location))" || bad "/admin status $(status admin)"
has admin x-ug-theme || has admin_r x-ug-theme && bad "admin page was themed" || ok "admin page not themed"
[[ "$(hval admin x-frame-options)" == "deny" && "$(hval admin content-security-policy)" == "$CSP" ]] && ok "admin page DENY + CSP identical to _headers" || bad "admin page headers differ"
# Cloudflare Web Analytics (automatic setup) inserts its beacon <script> into HTML at the edge; ignore that one tag.
strip_beacon() { sed -E -e 's#<script defer src=.https://static\.cloudflareinsights\.com/beacon\.min\.js[^>]*></script>##g' -e 's#<!-- Cloudflare Pages Analytics -->##g' "$1"; }
if cmp -s "$T/admin.b" admin.html; then ok "admin page body byte-identical to repo admin.html"
elif diff -q <(strip_beacon "$T/admin.b") <(strip_beacon admin.html) >/dev/null; then ok "admin page body identical to repo admin.html apart from Cloudflare's analytics beacon tag"
else bad "admin page body changed:"; diff <(strip_beacon admin.html) <(strip_beacon "$T/admin.b") | head -20; fi

echo; echo "== 3. API and other endpoints: unchanged vs production (status + content type), never themed"
cmpep() { # cmpep <path> [curl args]
  local p="$1"; shift; local n=api$(echo "$p" | tr -c 'a-z0-9' '_')
  get "$PREV$p" "$n" "$@"; get "$PROD$p" "${n}_p" "$@"
  local a b ca cb; a=$(status "$n"); b=$(status "${n}_p"); ca=$(hval "$n" content-type | cut -d';' -f1); cb=$(hval "${n}_p" content-type | cut -d';' -f1)
  if [[ "$a" == "$b" && "$ca" == "$cb" ]]; then ok "$p ${*:+($*) }preview $a $ca = production"
  elif [[ -n "$BASE" ]]; then
    get "$BASE$p" "${n}_b" "$@"; local c; c=$(status "${n}_b")
    if [[ "$a" == "$c" ]] && cmp -s "$T/$n.b" "$T/${n}_b.b"; then
      info "$p ${*:+($*) }preview $a vs production $b: identical to the baseline preview without this change (preview environment), body: $(head -c 120 "$T/$n.b")"
    else bad "$p ${*:+($*) }preview $a vs production $b vs baseline $c — body: $(head -c 120 "$T/$n.b")"; fi
  else bad "$p ${*:+($*) }preview $a $ca vs production $b $cb — body: $(head -c 120 "$T/$n.b")"; fi
  has "$n" x-ug-theme && bad "$p has x-ug-theme" || true
}
cmpep /api/news
cmpep /api/charts
cmpep /api/readers
cmpep /sitemap.xml
cmpep "/api/cover?a=Metallica&t=One"
cmpep "/api/band?name=Metallica"
cmpep /api/generate -X POST
cmpep /api/track-info -X POST
cmpep /api/newsletter/send -X POST
cmpep /assets/__missing__.css
get "$PREV/api/theme/refresh" r1; get "$PREV/api/theme/refresh" r2 -X POST
[[ "$(status r1)" == 405 && "$(status r2)" == 401 ]] && ok "/api/theme/refresh GET 405, POST without login 401" || bad "/api/theme/refresh GET $(status r1) POST $(status r2)"

echo; echo "== 4. Cloudflare Web Analytics injection (must not double)"
for p in / /admin /privacy /a/__no_such_story__; do
  n=wa$(echo "$p" | tr -c 'a-z' '_'); get "$PREV$p" "$n"; get "$PROD$p" "${n}_p"
  pb=$(grep -o 'beacon.min.js' "$T/$n.b" | wc -l); pc=$(grep -o 'Cloudflare Pages Analytics' "$T/$n.b" | wc -l)
  qb=$(grep -o 'beacon.min.js' "$T/${n}_p.b" | wc -l); qc=$(grep -o 'Cloudflare Pages Analytics' "$T/${n}_p.b" | wc -l)
  info "$p analytics: preview beacon=$pb markers=$pc | production beacon=$qb markers=$qc"
  [[ $pb -le 1 && $qb -le 1 ]] && ok "$p at most one analytics beacon" || bad "$p analytics beacon injected more than once"
done
if [[ -n "$BASE" ]]; then get "$BASE/admin" wa_base; info "baseline preview /admin: beacon=$(grep -o 'beacon.min.js' "$T/wa_base.b" | wc -l) markers=$(grep -o 'Cloudflare Pages Analytics' "$T/wa_base.b" | wc -l)"; fi

echo; echo "RESULT: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
