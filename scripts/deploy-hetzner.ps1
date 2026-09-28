# Deploy the committed ERP (HEAD) to the Hetzner VPS behind erp.del-groups.com.
#
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-hetzner.ps1
#
# Ships `git archive HEAD` (tracked files only — no .env), rebuilds the image
# on the server and restarts the `erp` container. The server keeps its own
# /opt/del-groups-erp/.env.production; Del Social AI's containers are untouched.
param(
  [string]$Server = "root@167.233.146.151",
  [string]$Key = "$HOME\.ssh\erp_hetzner_key"
)

$ErrorActionPreference = "Stop"

function Invoke-Checked([string]$Step, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)" }
}

Set-Location (git rev-parse --show-toplevel)

if (git status --porcelain --untracked-files=no) {
  throw "Tracked files have uncommitted changes. Commit first - the server gets exactly HEAD."
}

$sha = git rev-parse --short HEAD
$archive = Join-Path $env:TEMP "del-groups-erp-$sha.tar.gz"

Write-Host "==> packaging $sha"
Invoke-Checked "git archive" { git archive --format=tar.gz -o $archive HEAD }

Write-Host "==> uploading"
Invoke-Checked "scp" { scp -q -i $Key $archive "${Server}:/tmp/del-groups-erp.tar.gz" }
Remove-Item $archive

$remote = @'
set -e
cd /opt/del-groups-erp
find . -mindepth 1 -maxdepth 1 ! -name .env.production -exec rm -rf {} +
tar xzf /tmp/del-groups-erp.tar.gz
rm /tmp/del-groups-erp.tar.gz
echo "==> building and restarting"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --quiet-pull
docker image prune -f >/dev/null
echo "==> waiting for healthy"
for i in $(seq 1 45); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' del-groups-erp-erp-1)" = healthy ]; then
    echo "==> deploy ok"
    exit 0
  fi
  sleep 2
done
echo "!! not healthy after 90s"
docker logs --tail 40 del-groups-erp-erp-1
exit 1
'@ -replace "`r`n", "`n"

Invoke-Checked "remote deploy" { $remote | ssh -i $Key $Server "bash -s" }

Write-Host "==> live: https://erp.del-groups.com ($sha)"
