#!/usr/bin/env bash
# Read-only production smoke test. Only GET/HEAD requests to public pages, static files, public APIs and
# two public Supabase reads. Never writes, never calls admin, AI, newsletter, Telegram or upload endpoints.
# usage: smoke-production.sh [site-url]     Exit 1 when a check FAILs; WARNs never fail the run.
set -uo pipefail
SITE="${1:-https://music.mikasa.me}"; SITE="${SITE%/}"
SB="https://lhhmzfwjznlwkentbakv.supabase.co"; KEY="sb_publishable_MQDqmSmPb3qiSODbBOSKmA_U7aBEFtN" # public, same as the browser
T=$(mktemp -d); fails=(); warns=(); pass=0
ok()   { pass=$((pass+1)); echo "PASS  $*"; }
bad()  { fails+=("$*"); echo "FAIL  $*"; }
warn() { warns+=("$*"); echo "WARN  $*"; }
get()  { # get <url> <name> [curl args]  -> $T/<name>.hl (lower-case headers), .b (body), .s (status), .t (seconds)
  local u="$1" n="$2"; shift 2
  : > "$T/$n.h"; : > "$T/$n.b"
  local w; w=$(curl -s -m 30 "$@" -D "$T/$n.h" -o "$T/$n.b" -w "%{http_code} %{time_total}" "$u" || true)
  [[ -n "$w" ]] || w="000 0"
  echo "${w% *}" > "$T/$n.s"; echo "${w#* }" > "$T/$n.t"
  tr 'A-Z' 'a-z' < "$T/$n.h" 2>/dev/null | tr -d '\r' > "$T/$n.hl"
}
st()  { cat "$T/$1.s"; }
hv()  { grep "^$2:" "$T/$1.hl" | tail -1 | cut -d' ' -f2- ; }
CSP=$(grep -m1 "Content-Security-Policy:" _headers | sed 's/^ *Content-Security-Policy: *//' | tr 'A-Z' 'a-z')

echo "Smoke test $SITE  $(date -u +%FT%TZ)"
# 1. Home: up, fast enough, themed from the database
get "$SITE/" home
[[ "$(st home)" == 200 ]] && ok "home 200 ($(cat "$T/home.t")s)" || bad "home answered $(st home)"
awk "BEGIN{exit !($(cat "$T/home.t") < 5)}" || warn "home took $(cat "$T/home.t")s (> 5 s)"
th=$(hv home x-ug-theme); src=${th##*;}
case "$src" in
  rpc|cache) ok "theme $th" ;;
  stale|cache-stale) warn "theme $th: database not readable right now, last valid theme served" ;;
  *) bad "theme '$th': middleware has no valid theme (Supabase RPC ug_active_theme failing?)" ;;
esac
grep -q '<html[^>]*data-theme="' "$T/home.b" && ok "home <html data-theme>" || bad "home HTML has no data-theme (middleware not running?)"
# 2. Security headers on HTML pages
for p in / /admin /privacy; do
  n=sec$(printf '%s' "$p" | tr -c 'a-z' '_'); [[ "$p" == / ]] && n=home || get "$SITE$p" "$n"
  [[ "$(st "$n")" == 200 ]] || { bad "$p answered $(st "$n")"; continue; }
  [[ "$(hv "$n" content-security-policy)" == "$CSP" ]] && ok "$p CSP identical to _headers" || bad "$p CSP missing or different from _headers"
  [[ "$(hv "$n" x-frame-options)" == "deny" ]] && [[ -n "$(hv "$n" strict-transport-security)" ]] && [[ "$(hv "$n" x-content-type-options)" == "nosniff" ]] \
    && ok "$p X-Frame-Options DENY, HSTS, nosniff" || bad "$p missing X-Frame-Options/HSTS/nosniff"
done
[[ -z "$(hv sec_admin x-ug-theme)" ]] && ok "/admin not themed" || bad "/admin is themed (must never be)"
get "$SITE/a/__smoke_missing__" nf; [[ "$(st nf)" == 404 ]] && ok "unknown article 404" || bad "unknown article answered $(st nf)"
# 3. Static files match this commit; supabase-js pin + SRI still valid on the CDN
for f in assets/bento.css assets/bento.js assets/theme/schema.js assets/theme/runtime.js; do
  n=s$(printf '%s' "$f" | tr -c 'a-z' '_'); get "$SITE/$f" "$n"
  if [[ "$(st "$n")" == 200 ]] && cmp -s "$T/$n.b" "$f"; then ok "/$f deployed = main"; else warn "/$f differs from main (status $(st "$n")): deployment may still be in progress"; fi
done
src_js=$(grep -o 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@[^"]*' index.html | head -1); sri=$(grep -o 'integrity="sha384-[^"]*' index.html | head -1 | cut -d'"' -f2)
get "$src_js" sbjs
if [[ "$(st sbjs)" == 200 && "sha384-$(openssl dgst -sha384 -binary "$T/sbjs.b" | openssl base64 -A)" == "$sri" ]]; then ok "supabase-js on CDN matches SRI"; else bad "supabase-js $src_js: status $(st sbjs) or hash differs from integrity (site login and data would break)"; fi
# 4. SEO
get "$SITE/robots.txt" robots; grep -q "Sitemap: $SITE/sitemap.xml" "$T/robots.b" && ok "robots.txt lists the sitemap" || bad "robots.txt has no Sitemap line"
get "$SITE/sitemap.xml" sitemap; n=$(grep -o "<loc>$SITE/a/" "$T/sitemap.b" | wc -l)
[[ "$(st sitemap)" == 200 && $n -gt 0 ]] && ok "sitemap.xml 200 with $n articles" || bad "sitemap.xml status $(st sitemap), $n article URLs (Supabase read failing?)"
# 5. Public APIs (all cached at the edge, no AI)
get "$SITE/api/news" news; c=$(jq -r '.items | length' "$T/news.b" 2>/dev/null || echo 0)
[[ "$(st news)" == 200 && "$c" -gt 0 ]] && ok "/api/news $c items" || bad "/api/news status $(st news), $c items"
down=$(jq -r '[.sources[]? | select(.ok != true) | "\(.name) (\(.error // "failed"))"] | join(", ")' "$T/news.b" 2>/dev/null); [[ -z "$down" ]] || warn "Scene Radar sources failing: $down"
get "$SITE/api/charts" charts; [[ "$(st charts)" == 200 ]] && jq -e . "$T/charts.b" >/dev/null 2>&1 && ok "/api/charts 200 JSON" || bad "/api/charts status $(st charts): $(head -c 160 "$T/charts.b")"
get "$SITE/api/readers" readers; r=$(jq -r 'if .ok then "ok" else (.reason // "?") end' "$T/readers.b" 2>/dev/null)
[[ "$(st readers)" == 200 ]] || bad "/api/readers status $(st readers)"; [[ "$r" == ok ]] && ok "/api/readers ok" || warn "/api/readers ok:false ($r): footer box hidden"
# 6. Supabase public reads (same key and rules as any visitor)
get "$SB/rest/v1/rpc/ug_active_theme" rpc -H "apikey: $KEY"
[[ "$(st rpc)" == 200 ]] && jq -e '.theme and (.version|type=="number")' "$T/rpc.b" >/dev/null 2>&1 && ok "ug_active_theme: $(jq -c . "$T/rpc.b")" || bad "ug_active_theme status $(st rpc): $(head -c 160 "$T/rpc.b")"
get "$SB/rest/v1/articles?select=id&status=eq.published&limit=1" arts -H "apikey: $KEY"
[[ "$(st arts)" == 200 && "$(jq length "$T/arts.b" 2>/dev/null)" == 1 ]] && ok "published articles readable" || bad "articles read status $(st arts): $(head -c 160 "$T/arts.b")"

echo; echo "SMOKE: $pass passed, ${#warns[@]} warnings, ${#fails[@]} failed"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  { echo "## Production smoke test: ${#fails[@]} failed, ${#warns[@]} warnings, $pass passed"
    for f in "${fails[@]}"; do echo "- ❌ $f"; done; for w in "${warns[@]}"; do echo "- ⚠️ $w"; done; } >> "$GITHUB_STEP_SUMMARY"
fi
printf '%s\n' "${fails[@]}" > "$T/../smoke-failures.txt" 2>/dev/null || true
[[ ${#fails[@]} -eq 0 ]]
