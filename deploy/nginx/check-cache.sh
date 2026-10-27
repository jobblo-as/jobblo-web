#!/bin/bash
# Smoke check for the micro-cache in jobblo-server.conf. Run after `nginx -s reload`:
#   ./deploy/nginx/check-cache.sh https://jobblo.no
# HIT also accepts STALE/UPDATING: on a slow box the 3 s entry can expire between calls.
# Fails if an anonymous public GET is not cached, or a logged-in / non-public one is.
set -uo pipefail
BASE="${1:-http://127.0.0.1}"
fail=0
status() { curl -s -o /dev/null -D - "$@" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache-status"{print $2}'; }
expect() { # expect <regex for X-Cache-Status> <label> <curl args...>
  local want="$1" label="$2"; shift 2
  local got; got="$(status "$@")"
  if [[ "$got" =~ ^($want)$ ]]; then echo "ok   $label: $got"; else echo "FAIL $label: want $want, got '${got}'"; fail=1; fi
}
u="$BASE/api/categories?cachecheck=$RANDOM$RANDOM"   # fresh key: first is always MISS
expect MISS   "anonymous first"          "$u"
expect "HIT|STALE|UPDATING" "anonymous second"       "$u"
expect BYPASS "Authorization header"     -H "Authorization: Bearer x" "$u"
expect BYPASS "accessToken cookie"       -H "Cookie: a=1; accessToken=x" "$u"
expect BYPASS "connect.sid cookie"       -H "Cookie: connect.sid=x" "$u"
expect "HIT|STALE|UPDATING" "unrelated cookie only"    -H "Cookie: _ga=1" "$u"
expect BYPASS "listing detail (views)"   "$BASE/api/services/000000000000000000000000"
expect ""     "POST is never cached"     -X POST "$u"
exit $fail
