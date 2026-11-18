#!/usr/bin/env bash
# Checks a Cloudflare Pages preview deployment of this repo against the files in the commit.
# usage: verify-preview.sh <preview-url> [production-url]
set -uo pipefail
PREV="${1%/}"; PROD="${2:-https://music.mikasa.me}"; PROD="${PROD%/}"
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
get "$PREV/_routes.json" routes
if [[ "$(status routes)" == 200 ]] && cmp -s "$T/routes.b" _routes.json; then info "/_routes.json is served as a plain file"; else ok "/_routes.json is not served as a page asset (status $(status routes)); Pages consumed it as routing config"; fi
for f in _headers; do get "$PREV/$f" hdrs; cmp -s "$T/hdrs.b" "$f" && bad "/$f served publicly" || ok "/$f not served publicly (status $(status hdrs)) — same handling as _routes.json"; done

echo; echo "== 2. HTML pages run the middleware"
for p in "/" "/privacy.html" "/terms.html" "/a/__no_such_story__" "/band/__no_such_band__"; do
  n=page$(echo "$p" | tr -c 'a-z0-9' '_'); get "$PREV$p" "$n"; s=$(status "$n")
  th=$(hval "$n" x-ug-theme)
  [[ -n "$th" ]] && ok "$p status $s, x-ug-theme: $th" || bad "$p status $s, x-ug-theme missing"
  grep -q '<html[^>]*data-theme="neon-bento"' "$T/$n.b" && ok "$p <html data-theme=\"neon-bento\">" || bad "$p no data-theme on <html>"
  [[ "$(hval "$n" content-security-policy)" == "$CSP" ]] && ok "$p CSP identical to _headers" || bad "$p CSP differs from _headers"
  [[ "$(hval "$n" x-frame-options)" == "deny" ]] && has "$n" strict-transport-security && has "$n" x-content-type-options && has "$n" referrer-policy && has "$n" permissions-policy && has "$n" cross-origin-opener-policy \
    && ok "$p X-Frame-Options DENY, HSTS, nosniff, referrer, permissions, COOP" || bad "$p a security header is missing"
done
get "$PREV/" home_head -I
has home_head x-ug-theme && bad "HEAD / was themed" || ok "HEAD / passes through (no theme work)"
has home_head content-security-policy && ok "HEAD / still has CSP" || bad "HEAD / lost CSP"
get "$PREV/admin.html" admin; get "$PREV/admin" admin2
[[ "$(status admin)" == 200 || "$(status admin)" == 308 ]] && ok "/admin.html status $(status admin)" || bad "/admin.html status $(status admin)"
has admin x-ug-theme || has admin2 x-ug-theme && bad "admin page was themed" || ok "admin page not themed"
[[ "$(hval admin x-frame-options)" == "deny" && "$(hval admin content-security-policy)" == "$CSP" ]] && ok "admin page DENY + CSP identical to _headers" || bad "admin page headers differ"
[[ "$(status admin)" != 200 ]] || { cmp -s "$T/admin.b" admin.html && ok "admin.html body byte-identical to repo" || bad "admin.html body changed"; }

echo; echo "== 3. API and other endpoints: unchanged vs production (status + content type), never themed"
cmpep() { # cmpep <path> [curl args]
  local p="$1"; shift; local n=api$(echo "$p" | tr -c 'a-z0-9' '_')
  get "$PREV$p" "$n" "$@"; get "$PROD$p" "${n}_p" "$@"
  local a b ca cb; a=$(status "$n"); b=$(status "${n}_p"); ca=$(hval "$n" content-type | cut -d';' -f1); cb=$(hval "${n}_p" content-type | cut -d';' -f1)
  [[ "$a" == "$b" && "$ca" == "$cb" ]] && ok "$p ${*:+($*) }preview $a $ca = production" || bad "$p ${*:+($*) }preview $a $ca vs production $b $cb"
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
cmpep /api/auto-draft -X POST
cmpep /unsubscribe
cmpep /assets/__missing__.css
get "$PREV/api/theme/refresh" r1; get "$PREV/api/theme/refresh" r2 -X POST
[[ "$(status r1)" == 405 && "$(status r2)" == 401 ]] && ok "/api/theme/refresh GET 405, POST without login 401" || bad "/api/theme/refresh GET $(status r1) POST $(status r2)"

echo; echo "RESULT: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
