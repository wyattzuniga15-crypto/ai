@echo off
rem Tunes conversion settings to your voice (recordings in C:\GLaDOSVoice\samples\input).
rem Options: tune.bat --help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" tune %*
echo.
pause
