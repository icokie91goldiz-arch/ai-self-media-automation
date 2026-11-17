@echo off
set "ROOT=%MAITIAN_HOME%"
if not defined ROOT set "ROOT=%USERPROFILE%\maitian"
if not exist "%ROOT%\mdldm-maitian\src\hub.mjs" (
  echo [STOP] Maitian is NOT installed yet - %ROOT% not found.
  echo Please run install-windows.ps1 FIRST.
  pause
  exit /b 1
)
if not exist "%ROOT%\mdldm-maitian\data" mkdir "%ROOT%\mdldm-maitian\data"
cd /d "%ROOT%\mdldm-maitian"
echo Checking platform login status and upload pages (no upload, no fill).
node src\hub.mjs doctor
pause
