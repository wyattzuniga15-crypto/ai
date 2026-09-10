@echo off
rem Run this once to add Minecraft's music and records (a few hundred megabytes).
title Voxelcraft - get the music
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node get-music.mjs
  pause
  goto :eof
)
echo.
echo   This needs Node.js. Install it from https://nodejs.org and run this again.
echo.
pause
