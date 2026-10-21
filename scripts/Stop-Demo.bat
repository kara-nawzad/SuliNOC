@echo off
setlocal
REM Stop only SuliNOC's Uvicorn server on port 8000; unrelated listeners are left alone.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Demo.ps1"
set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" echo Stop failed; see the message above.
pause
exit /b %exitCode%
