@echo off
rem Optional TTS: type a line, get several GLaDOS takes. First run builds the TTS model (hours).
rem   tts.bat "Hello. It's been a long time."    or    tts.bat --file lines.txt --takes 8
rem Options: tts.bat --help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" tts %*
echo.
pause
