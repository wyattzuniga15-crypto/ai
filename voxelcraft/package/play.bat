@echo off
rem Double-click this to play. It starts a small server in this folder and opens the game.
title Voxelcraft
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  rem the server opens the window itself, in a browser with no tabs and no address bar
  node server.mjs
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo.
  echo   Voxelcraft is running at http://localhost:8080/
  echo   Close this window to stop it.
  echo.
  start "" http://localhost:8080/
  py -3 -m http.server 8080 --directory game
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo.
  echo   Voxelcraft is running at http://localhost:8080/
  echo   Close this window to stop it.
  echo.
  start "" http://localhost:8080/
  python -m http.server 8080 --directory game
  goto :eof
)

echo.
echo   Voxelcraft needs Node.js or Python 3 to serve its files.
echo   Install Node.js from https://nodejs.org and double-click this again.
echo.
pause
