@echo off
rem Double-click this for a report on what limits Minecraft FPS on this PC. It changes nothing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimize-minecraft.ps1" -Check %*
pause
