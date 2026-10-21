# Stop only the SuliNOC Uvicorn server listening on port 8000.
# Unrelated services that happen to use the port are deliberately left alone.
$ErrorActionPreference = "Stop"

$owners = @(
  Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
)

if ($owners.Count -eq 0) {
  Write-Host "No listener on port 8000."
  exit 0
}

$targets = @()
foreach ($ownerPid in $owners) {
  $process = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $ownerPid" `
    -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match '(?i)\buvicorn(?:\.exe)?\s+autonoc\.api\.main:app\b') {
    $targets += $process
  } else {
    Write-Warning "Leaving PID $ownerPid alone: it is not SuliNOC's Uvicorn app."
  }
}

if ($targets.Count -eq 0) {
  Write-Error "Port 8000 is in use, but no SuliNOC Uvicorn process was found. Nothing was stopped."
  exit 1
}

foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -Force
  Write-Host "Stopped SuliNOC Uvicorn (PID $($target.ProcessId))."
}
