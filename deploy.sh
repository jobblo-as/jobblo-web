#!/bin/bash
# Usage: ./deploy.sh [--skip-ci-check]
#   The target commit must have a green CI run on any branch (needs the gh CLI, logged in).
#   --skip-ci-check deploys without that check (hotfix, or gh not installed).
#   HEALTH_URL overrides the URL polled after the API restart.
# Stop at the first failing step instead of printing "Successful" anyway.
# -E: the ERR trap (rollback) also fires for a failure inside a function (restart_api).
set -Eeuo pipefail
# Works from any folder: always run from the repository root (where this script lives).
cd "$(dirname "$(readlink -f "$0")")"

SKIP_CI=0
case "${1:-}" in
  --skip-ci-check) SKIP_CI=1 ;;
  "") ;;
  *) echo "Unknown option: $1 (only --skip-ci-check)" >&2; exit 2 ;;
esac

# No /api/health route exists; filter options is a cheap public GET that reads MongoDB.
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5001/api/filter/options}"
# nginx serves frontend/dist; it is a symlink to one complete build in here.
RELEASES=.releases/frontend

# Pull the branch this server is on (main, or a feature branch running live).
BRANCH="$(git branch --show-current)"
# Detached HEAD: an empty branch would make `git fetch origin ""` fetch the default branch.
[ -n "$BRANCH" ] || { echo "Detached HEAD: check out the branch to deploy first." >&2; exit 1; }
# The remote this branch tracks: the server's may be named anything, not only "origin".
REMOTE="$(git config "branch.$BRANCH.remote" || git remote | head -1)"
[ -n "$REMOTE" ] || { echo "No git remote configured." >&2; exit 1; }
echo "→ Fetching $BRANCH from $REMOTE"
git fetch "$REMOTE" "$BRANCH"
TARGET="$(git rev-parse FETCH_HEAD)"

if [ "$SKIP_CI" = 0 ]; then
  command -v gh >/dev/null || { echo "gh CLI not found: cannot verify CI. Install gh or pass --skip-ci-check." >&2; exit 1; }
  CI="$(gh run list --workflow ci.yml --commit "$TARGET" --limit 1 --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"')"
  [ "$CI" = "completed success" ] || { echo "CI for ${TARGET:0:8} is '${CI:-no run}', not green. Wait, or pass --skip-ci-check." >&2; exit 1; }
fi

# The API reads only backend/.env.production in production (config/env.js); without it the
# restart would come up with no database or secrets. Stop before touching anything.
if [ ! -f backend/.env.production ]; then
  echo "backend/.env.production is missing (backend/.env is no longer read). On this server: mv backend/.env backend/.env.production" >&2
  exit 1
fi

PREV="$(git rev-parse HEAD)"
PREV_RELEASE="$(readlink frontend/dist 2>/dev/null || true)"
BACKEND_RESTARTED=0

# ecosystem.config.js sets NODE_ENV=production, HOST and kill_timeout; it reuses the
# existing pm2 process named jobblo-api, or starts it if missing. A rollback to a commit
# from before that file existed falls back to the plain restart.
restart_api() {
  (cd backend && npm ci --omit=dev &&
    if [ -f ecosystem.config.js ]; then pm2 startOrReload ecosystem.config.js --update-env
    else pm2 restart jobblo-api --update-env; fi)
}

# Any failure from here on puts the previous commit, API and frontend back.
rollback() {
  trap - ERR
  echo "✖ Deploy failed, rolling back to ${PREV:0:8}" >&2
  git reset --keep "$PREV"
  [ "$BACKEND_RESTARTED" = 1 ] && restart_api
  [ -n "$PREV_RELEASE" ] && ln -sfn "$PREV_RELEASE" frontend/dist.new && mv -Tf frontend/dist.new frontend/dist
  exit 1
}
trap rollback ERR

git merge --ff-only "$TARGET"

# Build first, into a new folder: the live site keeps serving the old build meanwhile.
echo "→ Frontend build"
RELEASE="$RELEASES/$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
mkdir -p "$RELEASE"
(cd frontend && npm ci && npm run build -- --outDir "../$RELEASE" --emptyOutDir)

echo "→ Backend"
BACKEND_RESTARTED=1
restart_api

echo "→ Health check $HEALTH_URL"
for i in $(seq 1 30); do
  curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL" && break
  [ "$i" = 30 ] && { echo "API not healthy after 60 s" >&2; false; }
  sleep 2
done

# Swap the build in atomically (rename of a symlink), so nginx never sees a half-built dist.
# First run only: the old real dist/ directory becomes a release itself.
if [ -d frontend/dist ] && [ ! -L frontend/dist ]; then
  PREV_RELEASE="../$RELEASES/initial-${PREV:0:8}"
  sudo mv frontend/dist "$RELEASES/initial-${PREV:0:8}"
  ln -s "$PREV_RELEASE" frontend/dist
fi
ln -sfn "../$RELEASE" frontend/dist.new
mv -Tf frontend/dist.new frontend/dist
sudo chown -R www-data:www-data "$RELEASE"

# reload, not restart: open connections (chat, uploads) are not dropped.
sudo nginx -t && sudo systemctl reload nginx
trap - ERR

# Keep the five newest builds (the live one is the newest). sudo: builds belong to www-data.
ls -1dt "$RELEASES"/*/ | tail -n +6 | xargs -r sudo rm -rf
echo "✅ Deployed $BRANCH @ $(git log -1 --format='%h %s')"
