@echo off
rem Double-click this to run optimize-minecraft.ps1. Close Minecraft first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimize-minecraft.ps1" %*
pause
