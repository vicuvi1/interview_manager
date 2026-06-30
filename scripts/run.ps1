# Interview Manager - launcher with auto-update from GitHub.
# Pulls the latest code, installs deps, starts the app, opens the browser,
# then keeps checking GitHub every minute and live-reloads on any update.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Port = 3000
$Url = "http://localhost:$Port"

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host ""
Write-Host "  Interview Manager" -ForegroundColor Cyan
Write-Host "  -----------------" -ForegroundColor DarkGray

if (-not (Have node)) {
  Write-Host "  Node.js is not installed. Install the LTS from https://nodejs.org and re-run." -ForegroundColor Red
  Read-Host "  Press Enter to exit"; exit 1
}
$hasGit = Have git
if (-not $hasGit) {
  Write-Host "  Git not found - auto-update is disabled. Install from https://git-scm.com to enable it." -ForegroundColor Yellow
}

# First-run config: make sure Supabase keys exist.
if (-not (Test-Path ".env.local")) {
  if (Test-Path ".env.example") { Copy-Item ".env.example" ".env.local" }
  Write-Host "  Created .env.local - add your Supabase URL + anon key, save, then continue." -ForegroundColor Yellow
  try { Start-Process notepad ".env.local" } catch {}
  Read-Host "  Press Enter once your keys are saved"
}

# Pull the latest before starting.
if ($hasGit) {
  Write-Host "  Checking for updates..." -ForegroundColor DarkGray
  try { git pull --ff-only | Out-Null } catch { Write-Host "  (skipped update: $_)" -ForegroundColor Yellow }
}

# Install dependencies if needed.
if (-not (Test-Path "node_modules")) {
  Write-Host "  Installing dependencies (first run, this can take a minute)..." -ForegroundColor DarkGray
  npm install
}

# Start the app (dev server hot-reloads when files change - including git pulls).
Write-Host "  Starting the app at $Url ..." -ForegroundColor Green
$server = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "-p", "$Port" -PassThru -WorkingDirectory $Root

Start-Sleep -Seconds 4
try { Start-Process $Url } catch {}

Write-Host ""
if ($hasGit) {
  Write-Host "  Running. Auto-updating from GitHub every 60s." -ForegroundColor Cyan
} else {
  Write-Host "  Running." -ForegroundColor Cyan
}
Write-Host "  Close this window (or Ctrl+C) to stop." -ForegroundColor DarkGray
Write-Host ""

try {
  while ($true) {
    Start-Sleep -Seconds 60
    if (-not $hasGit) { continue }
    if ($server.HasExited) { break }
    try {
      git fetch --quiet 2>$null
      $behind = git rev-list "HEAD..@{u}" --count 2>$null
      if ($LASTEXITCODE -eq 0 -and $behind -and ([int]$behind) -gt 0) {
        Write-Host "  Update found ($behind new commit(s)) - applying..." -ForegroundColor Green
        $changed = git diff --name-only "HEAD" "@{u}" 2>$null
        git pull --ff-only | Out-Null
        if ($changed -match "package(-lock)?\.json") {
          Write-Host "  Dependencies changed - installing..." -ForegroundColor DarkGray
          npm install
        }
        Write-Host "  Updated. The app reloads automatically." -ForegroundColor Green
      }
    } catch {
      Write-Host "  (update check failed: $_)" -ForegroundColor Yellow
    }
  }
}
finally {
  Write-Host "  Stopping the app..." -ForegroundColor DarkGray
  if ($server -and -not $server.HasExited) {
    try { taskkill /PID $server.Id /T /F | Out-Null } catch {}
  }
}
