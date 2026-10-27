#!/bin/bash
# One-time server setup (safe to run again): new nginx config, Redis, PM2.
# Usage on the server, from the repository root:   bash deploy/setup-server.sh
#
#  1. checks backend/.env.production and its REDIS_URL
#  2. Redis: installs/starts redis-server if needed, then PING with REDIS_URL
#  3. nginx: backs up /etc/nginx, installs deploy/nginx/*, `nginx -t`, reload;
#     any failure puts the backup back and reloads the old config
#  4. PM2: starts/reloads the API from backend/ecosystem.config.js, saves the process list
#  5. health checks
# Normal code deploys stay ./deploy.sh.
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

ENV_FILE=backend/.env.production
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/nginx-backup-$STAMP"
API_USER="$(whoami)"
ok() { echo "  ✔ $*"; }
die() { echo "  ✖ $*" >&2; exit 1; }

echo "→ 1/5 Env file"
[ -f "$ENV_FILE" ] || die "$ENV_FILE missing. The API no longer reads backend/.env: mv backend/.env $ENV_FILE"
REDIS_URL="$(grep -E '^REDIS_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^["'\'']|["'\'']$//g')"
if [ -n "$REDIS_URL" ]; then
  # redis://[:password@]host:port[/db] — a password without the @ makes the whole thing a password.
  [[ "$REDIS_URL" =~ ^rediss?://(:[^@]+@)?[A-Za-z0-9.-]+:[0-9]+(/[0-9]+)?$ ]] \
    || die "REDIS_URL looks wrong. Expected redis://:PASSWORD@127.0.0.1:6379 (note the @ after the password)"
  ok "REDIS_URL format"
else
  echo "  ! REDIS_URL not set: queues, cache and cluster mode stay off (the API still runs)"
fi

echo "→ 2/5 Redis"
if [ -n "$REDIS_URL" ]; then
  if ! command -v redis-server >/dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq redis-server
  fi
  sudo systemctl enable --now redis-server >/dev/null
  [ "$(redis-cli -u "$REDIS_URL" --no-auth-warning ping 2>&1)" = "PONG" ] \
    || die "Redis does not answer with REDIS_URL (password or port wrong? requirepass in /etc/redis/redis.conf?)"
  ok "Redis answers PONG"
fi

echo "→ 3/5 nginx (backup: $BACKUP)"
sudo cp -a /etc/nginx "$BACKUP"
ok "backup of /etc/nginx"
restore_nginx() {
  echo "  ✖ nginx step failed: restoring $BACKUP" >&2
  sudo rm -rf /etc/nginx && sudo cp -a "$BACKUP" /etc/nginx
  sudo nginx -t && sudo systemctl reload nginx
  exit 1
}
trap restore_nginx ERR
sudo mkdir -p /etc/nginx/snippets /var/cache/nginx/jobblo
sudo cp deploy/nginx/jobblo-http.conf             /etc/nginx/conf.d/jobblo-http.conf
sudo cp deploy/nginx/jobblo-server.conf           /etc/nginx/snippets/jobblo-server.conf
sudo cp deploy/nginx/jobblo-security-headers.conf /etc/nginx/snippets/jobblo-security-headers.conf
# The site itself: one real file in sites-available, linked from sites-enabled.
sudo cp deploy/nginx/jobblo-site.conf /etc/nginx/sites-available/jobblo
sudo ln -sfn /etc/nginx/sites-available/jobblo /etc/nginx/sites-enabled/jobblo
# The crawler map the share-card locations use. Checked only now: the old site file just
# replaced may have held it. Keep one the server still has elsewhere, else add ours.
if ! sudo grep -rqs 'map \$http_user_agent \$jobblo_is_crawler' /etc/nginx/nginx.conf /etc/nginx/conf.d /etc/nginx/sites-enabled; then
  sudo sed -n '/^map \$http_user_agent \$jobblo_is_crawler {/,/^}/p' deploy/nginx/jobblo-share-cards.conf \
    | sudo tee /etc/nginx/conf.d/jobblo-crawlers.conf >/dev/null
  ok "crawler map added (conf.d/jobblo-crawlers.conf)"
fi
sudo nginx -t
sudo systemctl reload nginx
trap - ERR
ok "new nginx config live"

echo "→ 4/5 PM2"
# The developer console's Nginx page reads /var/log/nginx/jobblo.json.log (group adm).
sudo usermod -aG adm "$API_USER"
command -v pm2 >/dev/null || sudo npm install -g pm2
# sg: run pm2 with the new adm group without logging out first.
sg adm -c "cd backend && pm2 startOrReload ecosystem.config.js --update-env && pm2 save"
ok "jobblo-api (re)started and saved"
# Start pm2 (and the API) again after a server reboot. Prints a sudo command once if not set up.
pm2 startup systemd -u "$API_USER" --hp "$HOME" 2>/dev/null | grep -E '^sudo ' || true

echo "→ 5/5 Health"
for i in $(seq 1 30); do
  curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:5001/api/filter/options && break
  [ "$i" = 30 ] && die "API not answering on 127.0.0.1:5001 after 60 s: pm2 logs jobblo-api"
  sleep 2
done
ok "API answers"
curl -fsS -o /dev/null --max-time 10 https://jobblo.no/api/filter/options && ok "https://jobblo.no/api answers" || echo "  ! https://jobblo.no/api did not answer"
curl -sI --max-time 10 https://jobblo.no/index.html | grep -qi '^cache-control: no-cache' && ok "index.html no-cache" || echo "  ! index.html has no no-cache header"
curl -sI --max-time 10 https://jobblo.no | grep -qi '^x-frame-options' && ok "security headers" || echo "  ! security headers missing"
curl -fsS --max-time 5 http://127.0.0.1:8090/nginx_status >/dev/null && ok "nginx_status for the developer console" || echo "  ! nginx_status not reachable"

echo "✅ Done. Old nginx config: $BACKUP   (undo: sudo rm -rf /etc/nginx && sudo cp -a $BACKUP /etc/nginx && sudo systemctl reload nginx)"
