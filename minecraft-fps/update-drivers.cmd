@echo off
rem Double-click this to open the official graphics driver updater for your NVIDIA, AMD or Intel graphics.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimize-minecraft.ps1" -Drivers %*
pause
