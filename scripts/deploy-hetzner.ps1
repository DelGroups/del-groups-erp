# Manually deploy the committed ERP (HEAD) to the Hetzner VPS behind
# erp.del-groups.com. Normally not needed: every push to main deploys through
# .github/workflows/deploy.yml. Requires the root key ~/.ssh/erp_hetzner_key.
#
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-hetzner.ps1
#
# Ships `git archive HEAD` (tracked files only - no .env) to the same server
# script the workflow uses (scripts/server/erp-deploy.sh).
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
Invoke-Checked "scp" { scp -q -i $Key $archive "${Server}:/tmp/del-groups-erp-$sha.tar.gz" }
Remove-Item $archive

Invoke-Checked "remote deploy" {
  ssh -i $Key $Server "del-groups-erp-deploy < /tmp/del-groups-erp-$sha.tar.gz; status=`$?; rm -f /tmp/del-groups-erp-$sha.tar.gz; exit `$status"
}

Write-Host "==> live: https://erp.del-groups.com ($sha)"
