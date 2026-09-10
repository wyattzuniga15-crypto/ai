@echo off
cd /d "%~dp0"
where node >nul 2>nul && (start "" http://localhost:8080/ & node server.mjs) || (echo Install Node.js from nodejs.org, then double-click this again. & pause)
