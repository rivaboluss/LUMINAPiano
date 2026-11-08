@echo off
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org
  echo Download the installer and run it. Downloading the file alone is not enough.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if errorlevel 1 (
  echo npm install failed
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo Build failed
  pause
  exit /b 1
)
call npm run preview
