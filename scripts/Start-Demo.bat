@echo off
REM ============================================================
REM  Start-Demo.bat - run the SuliNOC demo server in this window
REM ============================================================
REM  Double-click this file. It opens the dashboard and keeps the
REM  server attached to this window. No PowerShell is needed to start.
REM  To stop SuliNOC later, run scripts\Stop-Demo.bat.
REM ============================================================
cd /d "%~dp0.."

REM Never terminate an unrelated process that happens to own port 8000.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8000 .*LISTENING"') do (
    echo Port 8000 is already in use by PID %%p; no process was stopped.
    echo If it is SuliNOC, run scripts\Stop-Demo.bat. Otherwise free the port first.
    pause
    exit /b 1
)

set AUTONOC_SEED=131
set AUTONOC_AI=1

start "" http://127.0.0.1:8000

echo.
echo ============================================================
echo   SuliNOC demo starting (seed 131, AI on).
echo   Your browser should open http://127.0.0.1:8000
echo.
echo   Keep this window open while the demo server is running.
echo   Use scripts\Stop-Demo.bat to stop it safely from another window.
echo ============================================================
echo.
venv\Scripts\python.exe -m uvicorn autonoc.api.main:app --port 8000
pause
