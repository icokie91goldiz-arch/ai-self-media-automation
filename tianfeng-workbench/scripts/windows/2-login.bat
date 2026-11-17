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
echo This opens Maitian's DEDICATED Chrome (separate profile).
echo Log in to each platform yourself, then close it and run 3-doctor.bat.
node src\hub.mjs login
pause
