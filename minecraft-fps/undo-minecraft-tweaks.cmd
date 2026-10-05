@echo off
rem Double-click this to undo optimize-minecraft: original options.txt files and the Balanced power plan. Close Minecraft first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimize-minecraft.ps1" -Restore %*
pause
