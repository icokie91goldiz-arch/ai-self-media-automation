@echo off
set "ROOT=%MAITIAN_HOME%"
if not defined ROOT set "ROOT=%USERPROFILE%\maitian"
if not exist "%ROOT%\mdldm-maitian\src\demo.mjs" (
  echo [STOP] Maitian is NOT installed yet - %ROOT% not found.
  echo Please run install-windows.ps1 FIRST, then double-click this file.
  pause
  exit /b 1
)
cd /d "%ROOT%\mdldm-maitian"
echo Maitian DEMO mode - fake data, no real accounts touched.
echo Open in browser: http://localhost:8788/?key=demo
echo Press Ctrl+C in this window to stop.
node src\demo.mjs
pause
