# ============================================================
#  Start-Demo.ps1 - start the AutoNOC demo server (detached)
# ============================================================
#  The server runs in the background and keeps running even if
#  you close every PowerShell window. Nothing you type can stop
#  it. To stop it later, run scripts\Stop-Demo.bat from the project folder.
#
#  RUN from the repository root (the script also resolves its root from its path):
#     Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#     .\scripts\Start-Demo.ps1
#  From another directory, invoke this script by its full path.
# ============================================================

$ErrorActionPreference = "Continue"
# Resolve the repository root relative to this script, so it works from any
# clone/path and does not depend on the caller's current directory.
$scriptPath = if ($PSScriptRoot) {
    Join-Path $PSScriptRoot "Start-Demo.ps1"
} else {
    $MyInvocation.MyCommand.Path
}
$scriptDir = Split-Path -Parent $scriptPath
$root = Split-Path -Parent $scriptDir
$py = Join-Path $root "venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "venv python not found at $py" -ForegroundColor Red
    Write-Host "Looking for python on PATH instead..."
    $py = "python"
}

Write-Host "=== AutoNOC demo launcher ===" -ForegroundColor Cyan

# 1. Refuse to take over a port owned by any existing process.
$busy = @(
    Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
)
if ($busy.Count -gt 0) {
    $autoNocRunning = $false
    foreach ($ownerPid in $busy) {
        $process = Get-CimInstance Win32_Process `
            -Filter "ProcessId = $ownerPid" `
            -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -match '(?i)\buvicorn(?:\.exe)?\s+autonoc\.api\.main:app\b') {
            $autoNocRunning = $true
        }
    }
    if ($autoNocRunning) {
        Write-Host "  AutoNOC is already listening on port 8000." -ForegroundColor Yellow
        Write-Host "  Open http://127.0.0.1:8000 or stop it with scripts\Stop-Demo.bat."
    } else {
        Write-Host "  Port 8000 is occupied by another process; it was left untouched." -ForegroundColor Red
        Write-Host "  Free port 8000 before starting this demo."
    }
    return
}

# 2. demo seed + auto-enable the AI (inherited by the child process)
$env:AUTONOC_SEED = "131"
$env:AUTONOC_AI   = "1"

# 3. launch the server DETACHED (hidden window, logs to files)
$out = Join-Path $root "server.log"
$err = Join-Path $root "server.err"
Remove-Item $out, $err -ErrorAction SilentlyContinue

Write-Host "  starting server in the background (seed 131, AI on)..." -ForegroundColor Yellow
Start-Process -FilePath $py `
    -ArgumentList @("-m","uvicorn","autonoc.api.main:app","--port","8000") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err

# 4. wait and verify
Start-Sleep -Seconds 6
try {
    $h = (Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 6).Content | ConvertFrom-Json
    Write-Host ""
    Write-Host "  SERVER IS RUNNING" -ForegroundColor Green
    Write-Host "    seed   : $($h.seed)"
    Write-Host "    tick   : $($h.tick)"
    Write-Host "    ai     : $($h.ai_enabled)"
    Write-Host "    policy : $($h.ai_policy)"
} catch {
    Write-Host ""
    Write-Host "  Server did NOT start. Here is server.err:" -ForegroundColor Red
    if (Test-Path $err) { Get-Content $err -Tail 25 }
    if (Test-Path $out) { Write-Host "--- server.log ---"; Get-Content $out -Tail 10 }
}

# 5. open the dashboard (127.0.0.1, not localhost - avoids IPv6 issues
#    that can make fetch() fail with NetworkError)
Start-Process "http://127.0.0.1:8000"
Write-Host ""
Write-Host "  Browser should open http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "  If it does not, open http://127.0.0.1:8000 yourself."
Write-Host "  IMPORTANT: if the page still looks empty, press Ctrl+F5 once"
Write-Host "  to force the browser to drop its old cached copy."
Write-Host "  You can close ALL PowerShell windows now - the server"
Write-Host "  keeps running. To stop it, run scripts\Stop-Demo.bat from the project folder."
Write-Host "======================================================"
