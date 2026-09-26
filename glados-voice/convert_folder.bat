@echo off
rem Converts every WAV in a folder (default C:\GLaDOSVoice\dropbox) with your best settings.
rem Options: convert_folder.bat --help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" convert-folder %*
echo.
pause
