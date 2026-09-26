@echo off
rem GLaDOS mode: drag audio files or a folder onto this file.
rem Options: glados_mode.bat --help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" glados-mode %*
echo.
pause
