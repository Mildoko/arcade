@echo off
REM 1 Minute Arcade - local preview
REM double click this file. It stops old servers, starts a fresh one, opens the browser.
setlocal
cd /d "%~dp0"

if not exist "public\index.html" (
  echo [1/3] public\ not found, running build...
  node build.mjs --clean || goto :err
)

echo [2/3] stopping old servers on 8099...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8099" ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1

echo [3/3] serving http://127.0.0.1:8099/   (Ctrl+C to stop)
start "" "http://127.0.0.1:8099/"
python -m http.server 8099 --directory public
goto :eof

:err
echo build failed - see the error above
pause
