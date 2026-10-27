# Local test of the production setup: Redis + nginx (repo config) + the API in cluster mode +
# a frontend that talks to the API through nginx.
#   powershell -ExecutionPolicy Bypass -File backend\scripts\local-cluster.ps1 [-Workers 4] [-Production] [-NoNginx]
# Opens windows for Redis, the API (:5002) and the frontend (:5174); nginx runs in the background
# on :8085 (status on :8090). Leaves :5001/:5173 alone.
# Developer console: http://localhost:5174/developer  (Nginx, PM2, Caching, API Workers, Dependency Map)
# Stop: close the windows; nginx: C:\nginx\nginx.exe -p C:\nginx\ -s quit
#
# The scheduler is OFF: backend/.env.development holds the LIVE Stripe key, and auto-release/refund jobs must
# not run from a laptop. Redis: C:\redis, nginx: C:\nginx (portable Windows builds).
param(
  [int]$Workers = 4,
  [switch]$Production, # NODE_ENV=production (no request logging, real speed) with a throwaway SESSION_SECRET
  [switch]$NoNginx,
  [int]$ApiPort = 5002,
  [int]$WebPort = 5174,
  [int]$NginxPort = 8085,
  [string]$RedisDir = 'C:\redis',
  [string]$NginxDir = 'C:\nginx',
  # Own key prefix: other local API instances on the same Redis (default prefix "jobblo") would
  # otherwise share cache keys and show up on the Workers page as extra workers.
  [string]$RedisPrefix = 'jobblo-local'
)
$ErrorActionPreference = 'Stop'
$backend = Split-Path $PSScriptRoot -Parent
$repo = Split-Path $backend -Parent
$frontend = Join-Path $repo 'frontend'
$listening = { param($port) [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }
$utf8 = New-Object System.Text.UTF8Encoding($false) # nginx does not accept a BOM

# --- Redis
if (& $listening 6379) {
  Write-Host 'Redis already running on 6379'
} else {
  if (-not (Test-Path "$RedisDir\redis-server.exe")) { throw "redis-server.exe not found in $RedisDir" }
  Start-Process -FilePath "$RedisDir\redis-server.exe" -WorkingDirectory $RedisDir -ArgumentList '--bind', '127.0.0.1', '--port', '6379', '--save', '""', '--appendonly', 'no'
  Write-Host 'Started Redis on 127.0.0.1:6379'
}

# --- nginx: the repo's deploy/nginx files with local paths and the local API port
$useNginx = -not $NoNginx -and (Test-Path "$NginxDir\nginx.exe")
if ($useNginx) {
  $nd = $NginxDir -replace '\\', '/'
  $confDir = Join-Path $NginxDir 'conf\jobblo'
  New-Item -ItemType Directory -Force $confDir, "$NginxDir\cache\jobblo", "$NginxDir\logs", "$NginxDir\temp" | Out-Null
  foreach ($f in 'jobblo-http.conf', 'jobblo-server.conf', 'jobblo-security-headers.conf') {
    $text = [IO.File]::ReadAllText((Join-Path $repo "deploy\nginx\$f"))
    $text = $text -replace '/var/cache/nginx/jobblo', "$nd/cache/jobblo" -replace '/var/log/nginx/', "$nd/logs/" -replace 'snippets/', 'jobblo/' -replace '127\.0\.0\.1:5001', "127.0.0.1:$ApiPort"
    [IO.File]::WriteAllText((Join-Path $confDir $f), $text, $utf8)
  }
  $dist = ((Join-Path $frontend 'dist') -replace '\\', '/')
  $main = @"
worker_processes 1;
error_log logs/error.log warn;
pid logs/nginx.pid;
events { worker_connections 4096; }
http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    include jobblo/jobblo-http.conf;
    server {
        listen 127.0.0.1:$NginxPort;
        server_name localhost;
        root $dist;
        include jobblo/jobblo-server.conf;
        location / { try_files `$uri /index.html; }
    }
}
"@
  [IO.File]::WriteAllText((Join-Path $NginxDir 'conf\jobblo-local.conf'), $main, $utf8)
  # nginx writes "syntax is ok" to stderr; with 'Stop' PowerShell 5.1 would treat that as an error.
  $ErrorActionPreference = 'Continue'
  $test = & "$NginxDir\nginx.exe" -p "$NginxDir\" -c conf/jobblo-local.conf -t 2>&1 | Out-String
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = 'Stop'
  if (-not $ok) { throw "nginx config test failed:`n$test" }
  if (& $listening $NginxPort) {
    $ErrorActionPreference = 'Continue'
    & "$NginxDir\nginx.exe" -p "$NginxDir\" -c conf/jobblo-local.conf -s reload 2>&1 | Out-Null
    $ErrorActionPreference = 'Stop'
    Write-Host "nginx reloaded on :$NginxPort"
  } else {
    Start-Process -FilePath "$NginxDir\nginx.exe" -WorkingDirectory $NginxDir -ArgumentList '-p', "$NginxDir\", '-c', 'conf/jobblo-local.conf' -WindowStyle Hidden
    Write-Host "Started nginx on http://localhost:$NginxPort (status 127.0.0.1:8090)"
  }
}

# --- API (cluster)
if (& $listening $ApiPort) { throw "Port $ApiPort is already in use - stop that process or pass -ApiPort" }
$env_ = @(
  "`$env:PORT='$ApiPort'", "`$env:HOST='127.0.0.1'", "`$env:WEB_CONCURRENCY='$Workers'",
  "`$env:NODE_CLUSTER_SCHED_POLICY='rr'", "`$env:ENABLE_SCHEDULER='false'", "`$env:REDIS_URL='redis://127.0.0.1:6379'", "`$env:REDIS_PREFIX='$RedisPrefix'"
)
if ($useNginx) {
  $env_ += "`$env:NGINX_BIN='$NginxDir\nginx.exe'", "`$env:NGINX_STATUS_URL='http://127.0.0.1:8090/nginx_status'",
    "`$env:NGINX_ACCESS_LOG='$nd/logs/jobblo.json.log'", "`$env:NGINX_CACHE_DIR='$nd/cache/jobblo'"
}
if ($Production) {
  $secret = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $env_ += "`$env:NODE_ENV='production'", "`$env:SESSION_SECRET='$secret'", "`$env:FRONTEND_URL='http://localhost:$WebPort'"
}
$api = ($env_ -join '; ') + "; `$host.UI.RawUI.WindowTitle='Jobblo API :$ApiPort ($Workers workers)'; node server.js"
Start-Process powershell -WorkingDirectory $backend -ArgumentList '-NoExit', '-Command', $api
Write-Host "Started API on http://localhost:$ApiPort ($Workers workers, scheduler off)"

# --- Frontend (through nginx when it runs, like production)
$apiUrl = if ($useNginx) { "http://localhost:$NginxPort" } else { "http://localhost:$ApiPort" }
if (& $listening $WebPort) {
  Write-Host "Frontend port $WebPort already in use - skipped (restart it to change its API URL)"
} else {
  $web = "`$env:VITE_MAIN_URL='$apiUrl'; `$host.UI.RawUI.WindowTitle='Jobblo web :$WebPort'; npx vite --port $WebPort --strictPort"
  Start-Process powershell -WorkingDirectory $frontend -ArgumentList '-NoExit', '-Command', $web
  Write-Host "Started frontend on http://localhost:$WebPort (API: $apiUrl)"
}
Write-Host ''
Write-Host "Developer console: http://localhost:$WebPort/developer   (Nginx, PM2, Caching, API Workers, Dependency Map)"
Write-Host "Load test (API):   cd backend; node scripts/load-test.js --url http://localhost:$ApiPort --users 200 --seconds 30"
if ($useNginx) { Write-Host "Load test (nginx): cd backend; node scripts/load-test.js --url http://localhost:$NginxPort --users 50 --seconds 20   (nginx replaces X-Forwarded-For, so uncached routes hit the per-IP limit)" }
