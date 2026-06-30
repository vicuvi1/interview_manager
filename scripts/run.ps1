# Interview Manager - one-click launcher.
# Installs prerequisites (Node.js, Git) if missing, installs all app
# dependencies, starts the app, opens the browser, and keeps it auto-updated
# from GitHub while it runs.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# Reload PATH from the registry (so tools just installed become usable now).
function Update-Path {
  $m = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $u = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = (@($m, $u) | Where-Object { $_ }) -join ";"
}

# Ensure a CLI tool is present, installing it via winget when possible.
function Ensure-Tool($label, $cmd, $wingetId) {
  if (Have $cmd) { return $true }
  if (Have winget) {
    Write-Host "  Installing $label (one-time)..." -ForegroundColor DarkGray
    try {
      winget install --id $wingetId -e --silent `
        --accept-package-agreements --accept-source-agreements | Out-Null
    } catch {}
    Update-Path
    if (Have $cmd) { Write-Host "  $label installed." -ForegroundColor Green; return $true }
  }
  return $false
}

function Test-PortFree($port) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]$port)
    $listener.Start(); $listener.Stop(); return $true
  } catch { return $false }
}

function Get-FreePort($start) {
  for ($p = $start; $p -lt ($start + 50); $p++) { if (Test-PortFree $p) { return $p } }
  return $start
}

# Wait until the dev server answers (its first compile can take a while).
function Wait-Server($url, $timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3 | Out-Null
      return $true
    } catch {
      if ($_.Exception.Response) { return $true }  # server replied (redirect/4xx)
      Start-Sleep -Milliseconds 800
    }
  }
  return $false
}

Write-Host ""
Write-Host "  Interview Manager" -ForegroundColor Cyan
Write-Host "  -----------------" -ForegroundColor DarkGray

# 1) Prerequisites -------------------------------------------------------------
if (-not (Ensure-Tool "Node.js" "node" "OpenJS.NodeJS.LTS")) {
  Write-Host "  Node.js is required. Install the LTS from https://nodejs.org and re-run." -ForegroundColor Red
  Read-Host "  Press Enter to exit"; exit 1
}
$hasGit = Ensure-Tool "Git" "git" "Git.Git"
if (-not $hasGit) {
  Write-Host "  Git not found - the app still runs, but auto-update is off." -ForegroundColor Yellow
}

# 2) First-run config ----------------------------------------------------------
if (-not (Test-Path ".env.local")) {
  if (Test-Path ".env.example") { Copy-Item ".env.example" ".env.local" }
  Write-Host "  Add your Supabase URL + anon key to .env.local, save, then continue." -ForegroundColor Yellow
  try { Start-Process notepad ".env.local" } catch {}
  Read-Host "  Press Enter once your keys are saved"
}

# 3) Latest code ---------------------------------------------------------------
if ($hasGit) {
  Write-Host "  Getting the latest version..." -ForegroundColor DarkGray
  try { git pull --ff-only | Out-Null } catch { Write-Host "  (update skipped: $_)" -ForegroundColor Yellow }
}

# 4) Dependencies (always, so everything is guaranteed installed) --------------
Write-Host "  Installing dependencies..." -ForegroundColor DarkGray
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Dependency install failed. Check your internet connection and re-run." -ForegroundColor Red
  Read-Host "  Press Enter to exit"; exit 1
}

# 5) Start ---------------------------------------------------------------------
$Port = Get-FreePort 3000
$Url = "http://localhost:$Port"
Write-Host "  Starting the app..." -ForegroundColor Green
$server = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "-p", "$Port" `
  -PassThru -WorkingDirectory $Root

if (Wait-Server $Url 90) {
  Write-Host "  Ready: $Url" -ForegroundColor Cyan
} else {
  Write-Host "  Still starting - open $Url in your browser." -ForegroundColor Yellow
}
try { Start-Process $Url } catch {}

Write-Host ""
if ($hasGit) {
  Write-Host "  Auto-updating from GitHub every 60s. Close this window to stop." -ForegroundColor DarkGray
} else {
  Write-Host "  Close this window to stop." -ForegroundColor DarkGray
}
Write-Host ""

# 6) Live auto-update loop -----------------------------------------------------
try {
  while ($true) {
    Start-Sleep -Seconds 60
    if ($server.HasExited) { break }
    if (-not $hasGit) { continue }
    try {
      git fetch --quiet 2>$null
      $behind = git rev-list "HEAD..@{u}" --count 2>$null
      if ($LASTEXITCODE -eq 0 -and $behind -and ([int]$behind) -gt 0) {
        Write-Host "  Update found ($behind commit(s)) - applying..." -ForegroundColor Green
        $changed = git diff --name-only "HEAD" "@{u}" 2>$null
        git pull --ff-only | Out-Null
        if ($changed -match "package(-lock)?\.json") {
          Write-Host "  Installing new dependencies..." -ForegroundColor DarkGray
          npm install --no-fund --no-audit
        }
        Write-Host "  Updated - the app reloads automatically." -ForegroundColor Green
      }
    } catch {
      Write-Host "  (update check failed: $_)" -ForegroundColor Yellow
    }
  }
}
finally {
  Write-Host "  Stopping..." -ForegroundColor DarkGray
  if ($server -and -not $server.HasExited) {
    try { taskkill /PID $server.Id /T /F | Out-Null } catch {}
  }
}
